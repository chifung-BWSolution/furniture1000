// skp_writer <input.txt> <output.skp>
//
// Input (UTF-8, tab separated, millimetres, Z up):
//   name\t<furniture name>
//   part\t<component name>\t<x>\t<y>\t<z>        origin of the component in the model
//   face\tx,y,z;x,y,z;...                         polygon relative to that origin,
//                                                  counter-clockwise seen from outside
//
// Writes one top-level component holding one component per part, so each part
// can be opened and edited on its own in SketchUp. Needs the SketchUp C API (Windows).

#include <SketchUpAPI/sketchup.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr double kMmPerInch = 25.4;

using Face = std::vector<SUPoint3D>;

struct Part {
  std::string name;
  double x = 0, y = 0, z = 0;
  std::vector<Face> faces;
};

void check(SUResult result, const char* what) {
  if (result != SU_ERROR_NONE) {
    std::fprintf(stderr, "%s failed (SUResult %d)\n", what, static_cast<int>(result));
    std::exit(3);
  }
}

std::vector<std::string> split(const std::string& text, char sep) {
  std::vector<std::string> out;
  std::string cell;
  std::istringstream stream(text);
  while (std::getline(stream, cell, sep)) out.push_back(cell);
  return out;
}

bool parse_face(const std::string& text, Face& face) {
  for (const auto& vertex : split(text, ';')) {
    const auto xyz = split(vertex, ',');
    if (xyz.size() != 3) return false;
    face.push_back({std::atof(xyz[0].c_str()) / kMmPerInch,
                    std::atof(xyz[1].c_str()) / kMmPerInch,
                    std::atof(xyz[2].c_str()) / kMmPerInch});
  }
  return face.size() >= 3;
}

bool read_input(const char* path, std::string& name, std::vector<Part>& parts) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return false;
  std::string line;
  while (std::getline(file, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const auto cells = split(line, '\t');
    if (cells.size() == 2 && cells[0] == "name") {
      name = cells[1];
    } else if (cells.size() == 5 && cells[0] == "part") {
      Part part;
      part.name = cells[1];
      part.x = std::atof(cells[2].c_str()) / kMmPerInch;
      part.y = std::atof(cells[3].c_str()) / kMmPerInch;
      part.z = std::atof(cells[4].c_str()) / kMmPerInch;
      parts.push_back(part);
    } else if (cells.size() == 2 && cells[0] == "face") {
      Face face;
      if (parts.empty() || !parse_face(cells[1], face)) return false;
      parts.back().faces.push_back(face);
    }
  }
  if (parts.empty()) return false;
  for (const auto& part : parts) {
    if (part.faces.size() < 4) return false;
  }
  return true;
}

SUTransformation translation(double x, double y, double z) {
  SUTransformation t{};
  t.values[0] = t.values[5] = t.values[10] = t.values[15] = 1.0;
  t.values[12] = x;
  t.values[13] = y;
  t.values[14] = z;
  return t;
}

// Shared corners are welded, so the faces form one closed solid per part.
void fill_faces(SUEntitiesRef entities, const std::vector<Face>& faces) {
  SUGeometryInputRef input = SU_INVALID;
  check(SUGeometryInputCreate(&input), "SUGeometryInputCreate");
  size_t next_vertex = 0;
  for (const auto& face : faces) {
    SULoopInputRef loop = SU_INVALID;
    check(SULoopInputCreate(&loop), "SULoopInputCreate");
    for (const auto& point : face) {
      check(SUGeometryInputAddVertex(input, &point), "SUGeometryInputAddVertex");
      check(SULoopInputAddVertexIndex(loop, next_vertex++), "SULoopInputAddVertexIndex");
    }
    size_t added = 0;
    check(SUGeometryInputAddFace(input, &loop, &added), "SUGeometryInputAddFace");
  }
  check(SUEntitiesFill(entities, input, true), "SUEntitiesFill");
  SUGeometryInputRelease(&input);
}

SUComponentDefinitionRef new_definition(SUModelRef model, const std::string& name) {
  SUComponentDefinitionRef definition = SU_INVALID;
  check(SUComponentDefinitionCreate(&definition), "SUComponentDefinitionCreate");
  check(SUComponentDefinitionSetName(definition, name.c_str()), "SUComponentDefinitionSetName");
  check(SUModelAddComponentDefinitions(model, 1, &definition), "SUModelAddComponentDefinitions");
  return definition;
}

void place(SUEntitiesRef into, SUComponentDefinitionRef definition, const std::string& name, const SUTransformation& at) {
  SUComponentInstanceRef instance = SU_INVALID;
  check(SUComponentDefinitionCreateInstance(definition, &instance), "SUComponentDefinitionCreateInstance");
  check(SUComponentInstanceSetName(instance, name.c_str()), "SUComponentInstanceSetName");
  check(SUComponentInstanceSetTransform(instance, &at), "SUComponentInstanceSetTransform");
  check(SUEntitiesAddInstance(into, instance, nullptr), "SUEntitiesAddInstance");
}

// Show millimetres in SketchUp; geometry itself is always stored in inches.
void use_millimetres(SUModelRef model) {
  SUOptionsManagerRef options = SU_INVALID;
  if (SUModelGetOptionsManager(model, &options) != SU_ERROR_NONE) return;
  SUOptionsProviderRef units = SU_INVALID;
  if (SUOptionsManagerGetOptionsProviderByName(options, "UnitsOptions", &units) != SU_ERROR_NONE) return;
  SUTypedValueRef value = SU_INVALID;
  if (SUTypedValueCreate(&value) != SU_ERROR_NONE) return;
  SUTypedValueSetInt32(value, 0);  // decimal
  SUOptionsProviderSetValue(units, "LengthFormat", value);
  SUTypedValueSetInt32(value, 2);  // millimetres
  SUOptionsProviderSetValue(units, "LengthUnit", value);
  SUTypedValueRelease(&value);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: skp_writer <input.txt> <output.skp>\n");
    return 2;
  }
  std::string name = "Furniture";
  std::vector<Part> parts;
  if (!read_input(argv[1], name, parts)) {
    std::fprintf(stderr, "input invalid or has no parts\n");
    return 2;
  }

  SUInitialize();
  SUModelRef model = SU_INVALID;
  check(SUModelCreate(&model), "SUModelCreate");
  use_millimetres(model);

  SUComponentDefinitionRef furniture = new_definition(model, name);
  SUEntitiesRef furniture_entities = SU_INVALID;
  check(SUComponentDefinitionGetEntities(furniture, &furniture_entities), "SUComponentDefinitionGetEntities");

  for (const auto& part : parts) {
    SUComponentDefinitionRef definition = new_definition(model, part.name);
    SUEntitiesRef entities = SU_INVALID;
    check(SUComponentDefinitionGetEntities(definition, &entities), "SUComponentDefinitionGetEntities");
    fill_faces(entities, part.faces);
    place(furniture_entities, definition, part.name, translation(part.x, part.y, part.z));
  }

  SUEntitiesRef root = SU_INVALID;
  check(SUModelGetEntities(model, &root), "SUModelGetEntities");
  // Our +y is the front; SketchUp's front view looks at -y, so turn the piece 180° about Z.
  SUTransformation turn = translation(0, 0, 0);
  turn.values[0] = turn.values[5] = -1.0;
  place(root, furniture, name, turn);

  // SketchUp 2020 format so older installs in the office can still open the file.
  check(SUModelSaveToFileWithVersion(model, argv[2], SUModelVersion_SU2020), "SUModelSaveToFileWithVersion");
  SUModelRelease(&model);
  SUTerminate();
  return 0;
}

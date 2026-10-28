// skp_writer <input.txt> <output.skp>
//
// Input (UTF-8, tab separated, millimetres, Z up):
//   name\t<furniture name>
//   part\t<component name>\t<x>\t<y>\t<z>        origin of the component in the model
//   face\tx,y,z;x,y,z;...                         polygon relative to that origin,
//                                                  counter-clockwise seen from outside
//   hole\tx,y,z;...                               inner loop cut out of the face above it
//   mat\t#rrggbb\t<opacity 0..1>\t<kind>          colour of the part above it
//
// Writes one top-level component holding one component per part, so each part
// can be opened and edited on its own in SketchUp. Needs the SketchUp C API (Windows).

#include <SketchUpAPI/sketchup.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr double kMmPerInch = 25.4;

using Loop = std::vector<SUPoint3D>;

struct Face {
  Loop outer;
  std::vector<Loop> holes;
};

struct Look {
  bool set = false;
  std::string color;  // #rrggbb
  double opacity = 1.0;
  std::string kind;
};

struct Part {
  std::string name;
  double x = 0, y = 0, z = 0;
  std::vector<Face> faces;
  Look look;
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

bool parse_loop(const std::string& text, Loop& loop) {
  for (const auto& vertex : split(text, ';')) {
    const auto xyz = split(vertex, ',');
    if (xyz.size() != 3) return false;
    loop.push_back({std::atof(xyz[0].c_str()) / kMmPerInch,
                    std::atof(xyz[1].c_str()) / kMmPerInch,
                    std::atof(xyz[2].c_str()) / kMmPerInch});
  }
  return loop.size() >= 3;
}

bool hex_color(const std::string& text) {
  if (text.size() != 7 || text[0] != '#') return false;
  return std::all_of(text.begin() + 1, text.end(), [](char c) { return std::isxdigit(static_cast<unsigned char>(c)) != 0; });
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
      if (parts.empty() || !parse_loop(cells[1], face.outer)) return false;
      parts.back().faces.push_back(face);
    } else if (cells.size() == 2 && cells[0] == "hole") {
      Loop hole;
      if (parts.empty() || parts.back().faces.empty() || !parse_loop(cells[1], hole)) return false;
      parts.back().faces.back().holes.push_back(hole);
    } else if (cells.size() >= 2 && cells[0] == "mat") {
      if (parts.empty() || !hex_color(cells[1])) return false;
      Look& look = parts.back().look;
      look.set = true;
      look.color = cells[1];
      look.opacity = cells.size() >= 3 ? std::min(1.0, std::max(0.05, std::atof(cells[2].c_str()))) : 1.0;
      look.kind = cells.size() >= 4 ? cells[3] : "";
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
  auto make_loop = [&](const Loop& points) {
    SULoopInputRef loop = SU_INVALID;
    check(SULoopInputCreate(&loop), "SULoopInputCreate");
    for (const auto& point : points) {
      check(SUGeometryInputAddVertex(input, &point), "SUGeometryInputAddVertex");
      check(SULoopInputAddVertexIndex(loop, next_vertex++), "SULoopInputAddVertexIndex");
    }
    return loop;
  };
  for (const auto& face : faces) {
    SULoopInputRef outer = make_loop(face.outer);
    size_t added = 0;
    check(SUGeometryInputAddFace(input, &outer, &added), "SUGeometryInputAddFace");
    for (const auto& hole : face.holes) {
      SULoopInputRef inner = make_loop(hole);
      check(SUGeometryInputFaceAddInnerLoop(input, added, &inner), "SUGeometryInputFaceAddInnerLoop");
    }
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

SUComponentInstanceRef place(SUEntitiesRef into, SUComponentDefinitionRef definition, const std::string& name, const SUTransformation& at) {
  SUComponentInstanceRef instance = SU_INVALID;
  check(SUComponentDefinitionCreateInstance(definition, &instance), "SUComponentDefinitionCreateInstance");
  check(SUComponentInstanceSetName(instance, name.c_str()), "SUComponentInstanceSetName");
  check(SUComponentInstanceSetTransform(instance, &at), "SUComponentInstanceSetTransform");
  check(SUEntitiesAddInstance(into, instance, nullptr), "SUEntitiesAddInstance");
  return instance;
}

// One material per colour, opacity and kind; parts with the same look share it.
SUMaterialRef material_for(SUModelRef model, std::map<std::string, SUMaterialRef>& cache, const Look& look) {
  const int percent = static_cast<int>(look.opacity * 100 + 0.5);
  const std::string name = "FDS " + (look.kind.empty() ? std::string("colour") : look.kind) + " " + look.color + " " + std::to_string(percent);
  const auto found = cache.find(name);
  if (found != cache.end()) return found->second;
  SUMaterialRef material = SU_INVALID;
  check(SUMaterialCreate(&material), "SUMaterialCreate");
  check(SUMaterialSetName(material, name.c_str()), "SUMaterialSetName");
  const auto channel = [&](int at) { return static_cast<SUByte>(std::strtol(look.color.substr(at, 2).c_str(), nullptr, 16)); };
  SUColor color{channel(1), channel(3), channel(5), 255};
  check(SUMaterialSetColor(material, &color), "SUMaterialSetColor");
  if (percent < 100) {
    check(SUMaterialSetOpacity(material, look.opacity), "SUMaterialSetOpacity");
    check(SUMaterialSetUseOpacity(material, true), "SUMaterialSetUseOpacity");
  }
  check(SUModelAddMaterials(model, 1, &material), "SUModelAddMaterials");
  cache[name] = material;
  return material;
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

  std::map<std::string, SUMaterialRef> materials;
  for (const auto& part : parts) {
    SUComponentDefinitionRef definition = new_definition(model, part.name);
    SUEntitiesRef entities = SU_INVALID;
    check(SUComponentDefinitionGetEntities(definition, &entities), "SUComponentDefinitionGetEntities");
    fill_faces(entities, part.faces);
    SUComponentInstanceRef instance = place(furniture_entities, definition, part.name, translation(part.x, part.y, part.z));
    if (part.look.set) {
      check(SUDrawingElementSetMaterial(SUComponentInstanceToDrawingElement(instance), material_for(model, materials, part.look)),
            "SUDrawingElementSetMaterial");
    }
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

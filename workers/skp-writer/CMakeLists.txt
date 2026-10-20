cmake_minimum_required(VERSION 3.20)
project(skp_writer CXX)

set(CMAKE_CXX_STANDARD 17)
set(SKETCHUP_SDK_DIR "" CACHE PATH "Unzipped SketchUp C API SDK for Windows")
if(NOT EXISTS "${SKETCHUP_SDK_DIR}/headers/SketchUpAPI/sketchup.h")
  message(FATAL_ERROR "Set -DSKETCHUP_SDK_DIR=<SDK folder containing headers/ and binaries/>")
endif()

set(SKETCHUP_BIN "${SKETCHUP_SDK_DIR}/binaries/sketchup/x64")

add_executable(skp_writer skp_writer.cpp)
target_include_directories(skp_writer PRIVATE "${SKETCHUP_SDK_DIR}/headers")
target_link_libraries(skp_writer PRIVATE "${SKETCHUP_BIN}/SketchUpAPI.lib")
if(MSVC)
  target_compile_options(skp_writer PRIVATE /utf-8)
endif()

# The SDK DLLs must sit next to the exe at run time.
add_custom_command(TARGET skp_writer POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${SKETCHUP_BIN}" "$<TARGET_FILE_DIR:skp_writer>")

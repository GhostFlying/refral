cmake_minimum_required(VERSION 3.25)
project(refral_compiler LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include("${SOURCE_MANIFEST}")
add_executable(compiler compiler.cc ${ANGLE_SOURCES})
# This upstream source relies on a transitive iostream include in ANGLE's normal build.
set_source_files_properties(
  "${ANGLE_ROOT}/src/compiler/translator/wgsl/RewritePipelineVariables.cpp"
  PROPERTIES COMPILE_OPTIONS "-include;iostream")
target_include_directories(compiler PRIVATE
  "${ANGLE_ROOT}/include" "${ANGLE_ROOT}/src"
  "${ANGLE_ROOT}/src/common/base"
  "${ANGLE_ROOT}/src/common/third_party/xxhash/src"
  "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(compiler PRIVATE ANGLE_ENABLE_WGPU ANGLE_STANDALONE ANGLE_EXPORT= ANGLE_TRANSLATOR_STATIC EMSCRIPTEN)
target_compile_options(compiler PRIVATE -O2 -fno-exceptions -fno-rtti -Wno-unknown-warning-option)
target_link_options(compiler PRIVATE
  -O2 --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1
  -sEXPORT_NAME=RefralCompiler -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=4194304
  "-sEXPORTED_FUNCTIONS=['_RefralCompile','_RefralCompileWithExtensions','_RefralShaderExtensionMask']"
  "-sEXPORTED_RUNTIME_METHODS=['ccall']"
  -sENVIRONMENT=web,node -sFILESYSTEM=0)
set_target_properties(compiler PROPERTIES SUFFIX ".mjs"
  RUNTIME_OUTPUT_DIRECTORY "${OUTPUT_ROOT}")

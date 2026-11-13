#include <emscripten/emscripten.h>

#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#include "GLSLANG/ShaderLang.h"
#include "common/utilities.h"
#include "compiler/translator/blocklayout.h"
#include "refral_limits.h"

namespace {

std::string Quote(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (unsigned char character : value) {
    switch (character) {
      case '"':
        output << "\\\"";
        break;
      case '\\':
        output << "\\\\";
        break;
      case '\n':
        output << "\\n";
        break;
      case '\r':
        output << "\\r";
        break;
      case '\t':
        output << "\\t";
        break;
      default:
        if (character < 32) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<int>(character) << std::dec;
        } else {
          output << character;
        }
    }
  }
  output << '"';
  return output.str();
}

class DefaultUniformEncoder : public sh::Std140BlockEncoder {
 protected:
  void advanceOffset(GLenum type, size_t bytes_per_component,
                     const std::vector<unsigned int>& array_sizes,
                     bool is_row_major, int array_stride,
                     int matrix_stride) override {
    if (!gl::IsOpaqueType(type)) {
      sh::Std140BlockEncoder::advanceOffset(type, bytes_per_component,
                                            array_sizes, is_row_major,
                                            array_stride, matrix_stride);
    }
  }
};

void WriteVariable(std::ostream& output, const sh::ShaderVariable& variable,
                   const sh::BlockLayoutMap& layout) {
  const auto position = layout.find(variable.name);
  const sh::BlockMemberInfo info =
      position == layout.end() ? sh::BlockMemberInfo() : position->second;
  output << "{\"name\":" << Quote(variable.name)
         << ",\"mappedName\":" << Quote(variable.mappedName)
         << ",\"type\":" << variable.type
         << ",\"size\":" << variable.getBasicTypeElementCount()
         << ",\"active\":" << (variable.active ? "true" : "false")
         << ",\"precision\":" << variable.precision
         << ",\"offset\":" << info.offset
         << ",\"arrayStride\":" << info.arrayStride
         << ",\"matrixStride\":" << info.matrixStride << ",\"fields\":[";
  bool first = true;
  for (const auto& field : variable.fields) {
    if (!first) output << ',';
    WriteVariable(output, field, layout);
    first = false;
  }
  output << "]}";
}

void WriteVariables(std::ostream& output,
                    const std::vector<sh::ShaderVariable>* variables,
                    const sh::BlockLayoutMap& layout) {
  output << '[';
  bool first = true;
  if (variables != nullptr) {
    for (const auto& variable : *variables) {
      if (!first) output << ',';
      WriteVariable(output, variable, layout);
      first = false;
    }
  }
  output << ']';
}

}  // namespace

extern "C" EMSCRIPTEN_KEEPALIVE const char* RefralCompile(const char* source,
                                                          int stage,
                                                          int version) {
  static const bool initialized = sh::Initialize();
  static std::string result;
  if (!initialized) {
    result = "{\"success\":false,\"log\":\"ANGLE initialization failed\"}";
    return result.c_str();
  }
  ShBuiltInResources resources;
  sh::InitBuiltInResources(&resources);
  resources.MaxVertexAttribs = REFRAL_VERTEX_ATTRIBUTES;
  resources.MaxVertexUniformVectors = REFRAL_VERTEX_UNIFORM_VECTORS;
  resources.MaxFragmentUniformVectors = REFRAL_FRAGMENT_UNIFORM_VECTORS;
  resources.MaxVaryingVectors = REFRAL_VARYING_VECTORS;
  resources.MaxVertexTextureImageUnits = REFRAL_VERTEX_TEXTURE_UNITS;
  resources.MaxTextureImageUnits = REFRAL_FRAGMENT_TEXTURE_UNITS;
  resources.MaxCombinedTextureImageUnits = REFRAL_COMBINED_TEXTURE_UNITS;
  resources.FragmentPrecisionHigh = 1;
  ShHandle compiler =
      sh::ConstructCompiler(stage == 0 ? GL_VERTEX_SHADER : GL_FRAGMENT_SHADER,
                            version == 2 ? SH_WEBGL2_SPEC : SH_WEBGL_SPEC,
                            SH_WGSL_OUTPUT, &resources);
  if (compiler == nullptr) {
    result =
        "{\"success\":false,\"log\":\"ANGLE compiler construction failed\"}";
    return result.c_str();
  }
  ShCompileOptions options{};
  options.objectCode = true;
  options.validateAST = true;
  options.separateCompoundStructDeclarations = true;
  options.scalarizeVecAndMatConstructorArgs = true;
  options.removeInactiveVariables = true;
  const bool success = sh::Compile(compiler, &source, 1, options);
  sh::BlockLayoutMap uniform_layout;
  DefaultUniformEncoder encoder;
  if (success) {
    sh::GetActiveUniformBlockInfo(*sh::GetUniforms(compiler), "", &encoder,
                                  &uniform_layout);
  }
  std::ostringstream output;
  output << "{\"success\":" << (success ? "true" : "false")
         << ",\"log\":" << Quote(sh::GetInfoLog(compiler))
         << ",\"wgsl\":" << Quote(success ? sh::GetObjectCode(compiler) : "")
         << ",\"uniformBufferSize\":"
         << ((encoder.getCurrentOffset() + 15) / 16 * 16) << ",\"attributes\":";
  WriteVariables(output, success ? sh::GetAttributes(compiler) : nullptr, {});
  output << ",\"uniforms\":";
  WriteVariables(output, success ? sh::GetUniforms(compiler) : nullptr,
                 uniform_layout);
  output << ",\"varyings\":";
  WriteVariables(output, success ? sh::GetVaryings(compiler) : nullptr, {});
  output << ",\"outputs\":";
  WriteVariables(output, success ? sh::GetOutputVariables(compiler) : nullptr,
                 {});
  output << '}';
  result = output.str();
  sh::Destruct(compiler);
  return result.c_str();
}

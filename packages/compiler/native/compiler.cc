#include <emscripten/emscripten.h>

#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>
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

// Match the numeric default block left by ANGLE's structure-sampler extraction.
// A structure with only opaque fields contributes no alignment or array stride.
bool KeepNumericFields(sh::ShaderVariable* variable) {
  if (!variable->isStruct()) return !gl::IsOpaqueType(variable->type);
  std::vector<sh::ShaderVariable> numeric_fields;
  for (auto& field : variable->fields) {
    if (KeepNumericFields(&field)) numeric_fields.push_back(std::move(field));
  }
  variable->fields = std::move(numeric_fields);
  return !variable->fields.empty();
}

// A WebGL default block exposes every element of an array of structures.
// ANGLE's storage-block visitor only publishes element zero and its stride.
class UniformLayoutVisitor : public sh::BlockEncoderVisitor {
 public:
  UniformLayoutVisitor(sh::BlockLayoutEncoder* encoder, sh::BlockLayoutMap* layout)
      : sh::BlockEncoderVisitor("", "", encoder), layout_(layout) {}

  void enterArrayElement(const sh::ShaderVariable& array, unsigned int index) override {
    sh::VariableNameVisitor::enterArrayElement(array, index);
  }
  void exitArrayElement(const sh::ShaderVariable& array, unsigned int index) override {
    sh::VariableNameVisitor::exitArrayElement(array, index);
  }
  void encodeVariable(const sh::ShaderVariable& variable, const sh::BlockMemberInfo& info,
                      const std::string& name, const std::string&) override {
    if (!gl::IsOpaqueType(variable.type)) (*layout_)[name] = info;
  }

 private:
  sh::BlockLayoutMap* layout_;
};

void WriteStructUniforms(std::ostream& output, const sh::BlockLayoutMap& layout) {
  output << '[';
  bool first = true;
  for (const auto& [name, field] : layout) {
    if (name.find('.') == std::string::npos) continue;
    if (!first) output << ',';
    output << "{\"name\":" << Quote(name) << ",\"type\":" << field.type
           << ",\"size\":" << field.arraySize << ",\"offset\":" << field.offset
           << ",\"arrayStride\":" << field.arrayStride
           << ",\"matrixStride\":" << field.matrixStride << '}';
    first = false;
  }
  output << ']';
}

// ANGLE's register packer works on numeric uniforms. A struct array supplies
// one copy of each field per element. Keep basic arrays intact so their
// elements occupy distinct rows even when the shader only reads element zero.
bool CollectNumericUniforms(const sh::ShaderVariable& uniform, size_t copies,
                            size_t capacity,
                            std::vector<sh::ShaderVariable>* variables) {
  if (uniform.isStruct()) {
    const size_t extent = uniform.getArraySizeProduct();
    // Bound expansion by the total number of scalar slots before multiplying.
    copies = copies > capacity / extent ? capacity + 1 : copies * extent;
    for (const auto& field : uniform.fields) {
      if (!CollectNumericUniforms(field, copies, capacity, variables)) {
        return false;
      }
    }
  } else if (!gl::IsOpaqueType(uniform.type)) {
    if (copies > capacity - variables->size()) return false;
    variables->insert(variables->end(), copies, uniform);
  }
  return true;
}

bool UniformsFitStage(const std::vector<sh::ShaderVariable>& uniforms,
                      int max_vectors) {
  std::vector<sh::ShaderVariable> numeric_uniforms;
  for (const auto& uniform : uniforms) {
    if (uniform.staticUse &&
        !CollectNumericUniforms(uniform, 1, 4 * max_vectors, &numeric_uniforms)) {
      return false;
    }
  }
  return sh::CheckVariablesWithinPackingLimits(max_vectors, numeric_uniforms);
}

void WriteVariable(std::ostream& output, const sh::ShaderVariable& variable,
                   const sh::BlockLayoutMap& layout) {
  const auto position = layout.find(variable.name);
  const sh::BlockMemberInfo info =
      position == layout.end() ? sh::BlockMemberInfo() : position->second;
  output << "{\"name\":" << Quote(variable.name)
         << ",\"mappedName\":" << Quote(variable.mappedName)
         << ",\"structName\":" << Quote(variable.getStructName())
         << ",\"type\":" << variable.type
         << ",\"size\":" << variable.getBasicTypeElementCount()
         << ",\"isArray\":" << (variable.isArray() ? "true" : "false")
         << ",\"active\":" << (variable.active ? "true" : "false")
         << ",\"staticUse\":" << (variable.staticUse ? "true" : "false")
         << ",\"invariant\":" << (variable.isInvariant ? "true" : "false")
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
  std::string packing_error;
  if (success && version == 1) {
    const int limit = stage == 0 ? resources.MaxVertexUniformVectors
                                 : resources.MaxFragmentUniformVectors;
    if (!UniformsFitStage(*sh::GetUniforms(compiler), limit)) {
      packing_error = stage == 0 ? "Uniform packing exceeds MAX_VERTEX_UNIFORM_VECTORS."
                                 : "Uniform packing exceeds MAX_FRAGMENT_UNIFORM_VECTORS.";
    }
  }
  sh::BlockLayoutMap uniform_layout;
  sh::Std140BlockEncoder encoder;
  if (success && packing_error.empty()) {
    UniformLayoutVisitor visitor(&encoder, &uniform_layout);
    for (const auto& uniform : *sh::GetUniforms(compiler)) {
      if (uniform.active && !uniform.isBuiltIn()) {
        sh::ShaderVariable numeric = uniform;
        if (KeepNumericFields(&numeric)) {
          sh::TraverseShaderVariable(numeric, false, &visitor);
        }
      }
    }
  }
  std::ostringstream output;
  output << "{\"success\":" << (success ? "true" : "false")
         << ",\"log\":" << Quote(sh::GetInfoLog(compiler))
         << ",\"uniformPackingError\":" << Quote(packing_error)
         << ",\"wgsl\":" << Quote(success ? sh::GetObjectCode(compiler) : "")
         << ",\"uniformBufferSize\":"
         << ((encoder.getCurrentOffset() + 15) / 16 * 16) << ",\"attributes\":";
  WriteVariables(output, success ? sh::GetAttributes(compiler) : nullptr, {});
  output << ",\"uniforms\":";
  WriteVariables(output, success ? sh::GetUniforms(compiler) : nullptr,
                 uniform_layout);
  output << ",\"structUniforms\":";
  WriteStructUniforms(output, uniform_layout);
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

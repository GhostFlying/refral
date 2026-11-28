#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bench {
constexpr unsigned width = 800, height = 600, maxDraws = 20000;
struct Config {
  std::string json, vs, fs, vertexWGSL, fragmentWGSL, vertexEntry,
      fragmentEntry;
  std::vector<std::string> uniforms, attributes;
  std::vector<std::vector<float>> streams;
  uint32_t uniformBytes;
};
struct Backend {
  std::string adapter;
  virtual ~Backend() = default;
  virtual void uniform(unsigned slot, float value) = 0;
  virtual void draw(unsigned mode, int first, int count) = 0;
  virtual void clear() = 0;
  virtual void flush() = 0;
  virtual void finish() = 0;
  virtual std::vector<uint8_t> pixels() = 0;
};
std::unique_ptr<Backend> create(const std::string& name, const Config& c);
}  // namespace bench

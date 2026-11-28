#include <node.h>
#include <node_buffer.h>
#include <v8-fast-api-calls.h>

#include <stdexcept>

#include "backend.h"

namespace {
using namespace v8;
using Args = FunctionCallbackInfo<Value>;
std::unique_ptr<bench::Backend> backend;
std::array<Global<Object>, 6> locations;
std::array<uint64_t, 4>
    counts{};  // fast draw, fallback draw, fast uniform, fallback uniform
bool failed = false;
Local<String> key(Isolate* i, const char* name) {
  return String::NewFromUtf8(i, name).ToLocalChecked();
}
void fail(const Args& a, const char* why) {
  a.GetIsolate()->ThrowException(Exception::Error(key(a.GetIsolate(), why)));
}
std::string text(Isolate* i, Local<Value> v) {
  if (!v->IsString()) throw std::runtime_error("expected string");
  String::Utf8Value s(i, v);
  return {*s, size_t(s.length())};
}
Local<Value> field(Isolate* i, Local<Value> v, const char* name) {
  if (!v->IsObject()) throw std::runtime_error("expected record");
  return v.As<Object>()
      ->Get(i->GetCurrentContext(), key(i, name))
      .ToLocalChecked();
}
std::vector<Local<Value>> array(Isolate* i, Local<Value> v, unsigned expected) {
  if (!v->IsArray() || v.As<Array>()->Length() != expected)
    throw std::runtime_error("unexpected array size");
  std::vector<Local<Value>> items;
  for (unsigned j = 0; j < expected; j++)
    items.push_back(
        v.As<Array>()->Get(i->GetCurrentContext(), j).ToLocalChecked());
  return items;
}
void locationAt(const Args& a) {
  auto i = a.GetIsolate();
  auto j = a[0]->Uint32Value(i->GetCurrentContext()).FromMaybe(99);
  if (j >= locations.size()) {
    fail(a, "invalid location");
    return;
  }
  if (locations[j].IsEmpty()) locations[j].Reset(i, Object::New(i));
  a.GetReturnValue().Set(locations[j].Get(i));
}
void start(const Args& a) {
  auto i = a.GetIsolate();
  auto ctx = i->GetCurrentContext();
  try {
    if (backend) throw std::runtime_error("already initialized");
    bench::Config c;
    c.json = text(i, a[1]);
    Local<Value> config;
    if (!JSON::Parse(ctx, a[1].As<String>()).ToLocal(&config)) return;
    auto linked = field(i, config, "linked");
    c.vs = text(i, field(i, config, "vs"));
    c.fs = text(i, field(i, config, "fs"));
    c.vertexWGSL = text(i, field(i, linked, "vertexWGSL"));
    c.fragmentWGSL = text(i, field(i, linked, "fragmentWGSL"));
    c.vertexEntry = text(i, field(i, linked, "vertexEntryPoint"));
    c.fragmentEntry = text(i, field(i, linked, "fragmentEntryPoint"));
    c.uniformBytes = field(i, linked, "vertexUniformBufferSize")
                         ->Uint32Value(ctx)
                         .FromMaybe(0);
    if (c.uniformBytes != 32)
      throw std::runtime_error("unexpected Animometer uniform layout");
    for (auto u : array(i, field(i, linked, "uniforms"), 6))
      c.uniforms.push_back(text(i, field(i, u, "name")));
    for (auto v : array(i, field(i, linked, "attributes"), 2)) {
      if (field(i, v, "location")->Uint32Value(ctx).FromMaybe(99) !=
          c.attributes.size())
        throw std::runtime_error("attribute order");
      c.attributes.push_back(text(i, field(i, v, "name")));
    }
    for (auto stream : array(i, field(i, config, "streams"), 2)) {
      c.streams.emplace_back();
      for (auto v : array(i, stream, 12))
        c.streams.back().push_back(v->NumberValue(ctx).FromMaybe(0));
    }
    backend = bench::create(text(i, a[0]), c);
    counts = {};
    failed = false;
  } catch (const std::exception& e) {
    fail(a, e.what());
  }
}
void dispatchDraw(uint32_t mode, int32_t first, int32_t count) {
  if (!backend || mode != 4 || first != 0 || count != 3) {
    failed = true;
    return;
  }
  try {
    backend->draw(mode, first, count);
  } catch (...) {
    failed = true;
  }
}
void dispatchUniform(Local<Value> loc, float x) {
  if (!backend) {
    failed = true;
    return;
  }
  if (loc->IsNull()) return;
  for (unsigned j = 0; j < locations.size(); j++)
    if (locations[j] == loc) {
      backend->uniform(j, x);
      return;
    }
  failed = true;
}
void fastDraw(Local<Object>, uint32_t m, int32_t f, int32_t n) {
  ++counts[0];
  dispatchDraw(m, f, n);
}
void slowDraw(const Args& a) {
  ++counts[1];
  auto ctx = a.GetIsolate()->GetCurrentContext();
  if (a.Length() < 3) {
    fail(a, "drawArrays arguments");
    return;
  }
  dispatchDraw(a[0]->Uint32Value(ctx).FromMaybe(0),
               a[1]->Int32Value(ctx).FromMaybe(-1),
               a[2]->Int32Value(ctx).FromMaybe(-1));
}
void fastUniform(Local<Object>, Local<Object> loc, float x) {
  ++counts[2];
  dispatchUniform(loc, x);
}
void slowUniform(const Args& a) {
  ++counts[3];
  if (a.Length() < 2) {
    fail(a, "uniform1f arguments");
    return;
  }
  dispatchUniform(
      a[0],
      static_cast<float>(
          a[1]->NumberValue(a.GetIsolate()->GetCurrentContext()).FromMaybe(0)));
}
void clear(const Args& a) {
  try {
    if (!backend ||
        a[0]->Uint32Value(a.GetIsolate()->GetCurrentContext()).FromMaybe(0) !=
            0x4000)
      throw std::runtime_error("unexpected clear");
    backend->clear();
  } catch (const std::exception& e) {
    fail(a, e.what());
  }
}
void flush(const Args& a) {
  try {
    if (!backend || failed) throw std::runtime_error("invalid fixture call");
    backend->flush();
  } catch (const std::exception& e) {
    fail(a, e.what());
  }
}
void finish(const Args& a) {
  try {
    if (backend) backend->finish();
  } catch (const std::exception& e) {
    fail(a, e.what());
  }
}
void pixels(const Args& a) {
  try {
    if (!backend) throw std::runtime_error("no target");
    auto p = backend->pixels();
    a.GetReturnValue().Set(
        node::Buffer::Copy(a.GetIsolate(),
                           reinterpret_cast<const char*>(p.data()), p.size())
            .ToLocalChecked());
  } catch (const std::exception& e) {
    fail(a, e.what());
  }
}
void stats(const Args& a) {
  auto i = a.GetIsolate();
  auto v = Array::New(i, 4);
  for (unsigned j = 0; j < 4; j++)
    v->Set(i->GetCurrentContext(), j, Number::New(i, counts[j])).Check();
  a.GetReturnValue().Set(v);
}
void adapter(const Args& a) {
  a.GetReturnValue().Set(
      key(a.GetIsolate(), backend ? backend->adapter.c_str() : ""));
}
void stop(const Args&) {
  for (auto& loc : locations) loc.Reset();
  backend.reset();
}
void init(Local<Object> exports) {
  auto i = exports->GetIsolate();
  static const CFunction draw = CFunction::Make(fastDraw),
                         uniform = CFunction::Make(fastUniform);
  auto method = [&](const char* name, FunctionCallback fallback, int length,
                    const CFunction* hot) {
    auto t = FunctionTemplate::New(i, fallback, {}, {}, length,
                                   ConstructorBehavior::kThrow,
                                   SideEffectType::kHasSideEffect, hot);
    exports
        ->Set(i->GetCurrentContext(), key(i, name),
              t->GetFunction(i->GetCurrentContext()).ToLocalChecked())
        .Check();
  };
  method("drawArrays", slowDraw, 3, &draw);
  method("uniform1f", slowUniform, 2, &uniform);
  NODE_SET_METHOD(exports, "locationAt", locationAt);
  NODE_SET_METHOD(exports, "start", start);
  NODE_SET_METHOD(exports, "stop", stop);
  NODE_SET_METHOD(exports, "clear", clear);
  NODE_SET_METHOD(exports, "flush", flush);
  NODE_SET_METHOD(exports, "finish", finish);
  NODE_SET_METHOD(exports, "pixels", pixels);
  NODE_SET_METHOD(exports, "stats", stats);
  NODE_SET_METHOD(exports, "adapter", adapter);
  node::AddEnvironmentCleanupHook(
      i,
      [](void*) {
        for (auto& loc : locations) loc.Reset();
        backend.reset();
      },
      nullptr);
}
NODE_MODULE(native_animometer, init)
}  // namespace

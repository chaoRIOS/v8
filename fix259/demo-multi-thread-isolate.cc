#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <limits.h>
#include <thread>

#include "include/libplatform/libplatform.h"
#include "include/libplatform/v8-tracing.h"
#include "src/api-inl.h"
#include "src/base/cpu.h"
#include "src/base/logging.h"
#include "src/objects-inl.h"
#include "src/objects.h"
#include "src/utils.h"
#include "src/v8.h"

namespace demo {

std::unique_ptr<v8::Platform> g_platform;

static inline v8::Local<v8::String> v8_str(const char* x) {
  return v8::String::NewFromUtf8(v8::Isolate::GetCurrent(), x,
                                 v8::NewStringType::kNormal)
      .ToLocalChecked();
}

static inline v8::Local<v8::Script> v8_compile(v8::Local<v8::String> x) {
  v8::Local<v8::Script> result;
  if (v8::Script::Compile(v8::Isolate::GetCurrent()->GetCurrentContext(), x)
          .ToLocal(&result)) {
    return result;
  }
  return v8::Local<v8::Script>();
}

static inline v8::Local<v8::Value> CompileRun(v8::Local<v8::String> source) {
  v8::Local<v8::Value> result;
  if (v8_compile(source)
          ->Run(v8::Isolate::GetCurrent()->GetCurrentContext())
          .ToLocal(&result)) {
    return result;
  }
  return v8::Local<v8::Value>();
}

static inline v8::Local<v8::Value> CompileRun(const char* source) {
  return CompileRun(v8_str(source));
}

static void CalcFibonacci(int limit) {
  v8::Isolate::CreateParams create_params;
  create_params.array_buffer_allocator =
                        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
  v8::Isolate* isolate = v8::Isolate::New(create_params);
  {
    v8::Isolate::Scope isolate_scope(isolate);
    v8::HandleScope scope(isolate);

    v8::Local<v8::Context> context =
        v8::Context::New(isolate);
    {
      v8::Context::Scope context_scope(context);
    
      i::ScopedVector<char> code(1024);
      i::SNPrintF(code, "function fib(n) {"
                        "  if (n <= 2) return 1;"
                        "  return fib(n-1) + fib(n-2);"
                        "}"
                        "fib(%d)", limit);
      v8::Local<v8::Value> value = CompileRun(code.start());
      CHECK(value->IsNumber());
      std::cout<<"tid:"<<std::this_thread::get_id()<<
        " result:"<<static_cast<int>(value->NumberValue(context).FromJust())<<std::endl;
    }
  }
  isolate->Dispose();
  delete create_params.array_buffer_allocator;
}

void Test() {
  std::thread thread1(CalcFibonacci, 21);
  std::thread thread2(CalcFibonacci, 12);

  thread1.join();
  thread2.join();
}

int Main(int argc, char* argv[]) {
  // new default platform. use v8::platform::CreateDefaultPlatform() in old version
  g_platform = v8::platform::NewDefaultPlatform();

  // init platform
  v8::V8::InitializePlatform(g_platform.get());
  v8::V8::Initialize();

  // set natives_blob / snapshot_blob file path.
  // you can use InitializeExternalStartupData(const char* natives_blob, const char* snapshot_blob)
  v8::V8::InitializeExternalStartupData(argv[0]);

  Test();

  v8::V8::Dispose();
  v8::V8::ShutdownPlatform();

  // Delete the platform explicitly here to write the tracing output to the
  // tracing file.
  g_platform.reset();
  return 0;
}

}  // namespace demo

int main(int argc, char* argv[]) {
  return demo::Main(argc, argv);
}
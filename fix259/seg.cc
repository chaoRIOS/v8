#define BUILD(r, __VA_ARGS__...)                                               \
  do {                                                                         \
    byte code[] = {__VA_ARGS__};                                               \
    r.Build(code, code + arraysize(code));                                     \
  } while (false)
Expands to :

do {
  byte code[] = {
      static_cast<byte>(CheckI32v((123), 4), kExprI32Const),
      static_cast<byte>(((123) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((123) >> 7) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((123) >> 14) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>(((123) >> 21) & ((1 << 7) - 1)),
      kExprLocalGet,
      static_cast<byte>(0),
      kAtomicPrefix,
      static_cast<byte>(kExprI64AtomicStore),
      static_cast<byte>(ElementSizeLog2Of(MachineRepresentation::kWord64)),
      0,
      static_cast<byte>(CheckI32v((222), 5), kExprI32Const),
      static_cast<byte>(((222) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((222) >> 7) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((222) >> 14) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((222) >> 21) & ((1 << 7) - 1)) | 0x80),
      static_cast<byte>((((222) >> 28) & ((1 << 7) - 1))),
      kAtomicPrefix,
      static_cast<byte>(kExprI64AtomicLoad),
      static_cast<byte>(ElementSizeLog2Of(MachineRepresentation::kWord64)),
      0};
  r.Build(code, code + arraysize(code));
}
while (false)

  void WasmFunctionCompiler::Build(const byte *start, const byte *end) {
    size_t locals_size = local_decls.Size();
    size_t total_size = end - start + locals_size + 1;
    byte *buffer =
        zone()->NewArray<byte, WasmFunctionCompilerBuffer>(total_size);
    // Prepend the local decls to the code.
    local_decls.Emit(buffer);
    // Emit the code.
    memcpy(buffer + locals_size, start, end - start);
    // Append an extra end opcode.
    buffer[total_size - 1] = kExprEnd;

    start = buffer;
    end = buffer + total_size;

    CHECK_GE(kMaxInt, end - start);
    int len = static_cast<int>(end - start);
    function_->code = {builder_->AddBytes(Vector<const byte>(start, len)),
                       static_cast<uint32_t>(len)};

    if (interpreter_) {
      // Add the code to the interpreter; do not generate compiled code.
      interpreter_->SetFunctionCodeForTesting(function_, start, end);
      return;
    }

    Vector<const uint8_t> wire_bytes = builder_->instance_object()
                                           ->module_object()
                                           .native_module()
                                           ->wire_bytes();

    CompilationEnv env = builder_->CreateCompilationEnv();
    ScopedVector<uint8_t> func_wire_bytes(function_->code.length());
    memcpy(func_wire_bytes.begin(),
           wire_bytes.begin() + function_->code.offset(),
           func_wire_bytes.length());

    FunctionBody func_body{function_->sig, function_->code.offset(),
                           func_wire_bytes.begin(), func_wire_bytes.end()};
    NativeModule *native_module =
        builder_->instance_object()->module_object().native_module();
    ForDebugging for_debugging =
        native_module->IsTieredDown() ? kForDebugging : kNoDebugging;
    WasmCompilationUnit unit(function_->func_index, builder_->execution_tier(),
                             for_debugging);
    WasmFeatures unused_detected_features;
    WasmCompilationResult result = unit.ExecuteCompilation(
        isolate()->wasm_engine(), &env,
        native_module->compilation_state()->GetWireBytesStorage(),
        isolate()->counters(), &unused_detected_features);
    WasmCode *code = native_module->PublishCode(
        native_module->AddCompiledCode(std::move(result)));
    DCHECK_NOT_NULL(code);
    if (WasmCode::ShouldBeLogged(isolate()))
      code->LogCode(isolate());
  }
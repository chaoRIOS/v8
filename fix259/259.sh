#!/bin/bash

clear
# --test test/mjsunit/mjsunit.js test/mjsunit/wasm/atomics64-stress.js \
# --predictable \
# out/x64.debug/d8 \
out/riscv64.sim/d8 \
--test test/mjsunit/mjsunit.js fix259/atomics64-stress.js \
--experimental-wasm-threads \
\
--no-trace-turbo \
--no-trace-turbo-graph \
--no-turbo-instruction-scheduling \
\
--no-trace-wasm \
--no-trace-wasm-compiler \
--no-trace-wasm-decoder \
--no-trace-wasm-instances \
--no-trace-wasm-native-heap \
--no-trace-wasm-memory \
--print-wasm-code \
# --no-turbo-stats-wasm \
# --no-testing-d8-test-runner \
# --print-bytecode \
# --dump-wasm-module \
# --dump-wasm-module-path="./"
#--random-seed=471784578 \
#--nohard-abort \


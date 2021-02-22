// Copyright 2018 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --experimental-wasm-threads

// This test might time out if the search space for a sequential
// interleaving becomes to large. However, it should never fail.
// Note that results of this test are flaky by design. While the test is
// deterministic with a fixed seed, bugs may introduce non-determinism.

load('/home/cwang/work/v8/test/mjsunit/wasm/wasm-module-builder.js');

const kDebug = true;

// const kSequenceLength = 256;
let kSequenceLength = 10;
let kNumberOfWorker = 1;
const kNumberOfSteps = 10000000;

const kFirstOpcodeWithInput = 4;
const kFirstOpcodeWithoutOutput = 4;
const kLastOpcodeWithoutOutput = 7;


// Instructions are ordered in 64, 8, 16, 32 bits size

const opCodes = [
  kExprI64AtomicLoad,     kExprI64AtomicLoad8U,     kExprI64AtomicLoad16U,      kExprI64AtomicLoad32U,    // No input, Has output
  kExprI64AtomicStore,    kExprI64AtomicStore8U,    kExprI64AtomicStore16U,     kExprI64AtomicStore32U,   // Has input, No output
  kExprI64AtomicAdd,      kExprI64AtomicAdd8U,      kExprI64AtomicAdd16U,       kExprI64AtomicAdd32U,     // Has input, Has output
  kExprI64AtomicSub,      kExprI64AtomicSub8U,      kExprI64AtomicSub16U,       kExprI64AtomicSub32U,     // Has input, Has output
  kExprI64AtomicAnd,      kExprI64AtomicAnd8U,      kExprI64AtomicAnd16U,       kExprI64AtomicAnd32U,     // Has input, Has output
  kExprI64AtomicOr,       kExprI64AtomicOr8U,       kExprI64AtomicOr16U,        kExprI64AtomicOr32U,      // Has input, Has output
  kExprI64AtomicXor,      kExprI64AtomicXor8U,      kExprI64AtomicXor16U,       kExprI64AtomicXor32U,     // Has input, Has output
  kExprI64AtomicExchange, kExprI64AtomicExchange8U, kExprI64AtomicExchange16U,  kExprI64AtomicExchange32U // Has input, Has output
];

const opCodeNames = [
  'kExprI64AtomicLoad',        'kExprI64AtomicLoad8U',
  'kExprI64AtomicLoad16U',     'kExprI64AtomicLoad32U',
  'kExprI64AtomicStore',       'kExprI64AtomicStore8U',
  'kExprI64AtomicStore16U',    'kExprI64AtomicStore32U',
  'kExprI64AtomicAdd',         'kExprI64AtomicAdd8U',
  'kExprI64AtomicAdd16U',      'kExprI64AtomicAdd32U',
  'kExprI64AtomicSub',         'kExprI64AtomicSub8U',
  'kExprI64AtomicSub16U',      'kExprI64AtomicSub32U',
  'kExprI64AtomicAnd',         'kExprI64AtomicAnd8U',
  'kExprI64AtomicAnd16U',      'kExprI64AtomicAnd32U',
  'kExprI64AtomicOr',          'kExprI64AtomicOr8U',
  'kExprI64AtomicOr16U',       'kExprI64AtomicOr32U',
  'kExprI64AtomicXor',         'kExprI64AtomicXor8U',
  'kExprI64AtomicXor16U',      'kExprI64AtomicXor32U',
  'kExprI64AtomicExchange',    'kExprI64AtomicExchange8U',
  'kExprI64AtomicExchange16U', 'kExprI64AtomicExchange32U'
];

let kMaxMemPages = 10;
let gSharedMemory =
    new WebAssembly.Memory({initial: 1, maximum: kMaxMemPages, shared: true});
let gSharedMemoryView = new Int32Array(gSharedMemory.buffer);

let gPrivateMemory =
    new WebAssembly.Memory({initial: 1, maximum: kMaxMemPages, shared: true});
let gPrivateMemoryView = new Int32Array(gPrivateMemory.buffer);

const kMaxInt32 = (1 << 31) * 2;



// Class Operation


class Operation {
  constructor(opcode, low_input, high_input, offset) {
    this.opcode = opcode != undefined ? opcode : Operation.nextOpcode();
    this.size = Operation.opcodeToSize(this.opcode);
    if (low_input == undefined) {
      [low_input, high_input] = Operation.inputForSize(this.size);
    }
    this.low_input = low_input;
    this.high_input = high_input;
    this.offset =
        offset != undefined ? offset : Operation.offsetForSize(this.size);
  }

  static nextOpcode() {
    let random = Math.random();
    return Math.floor(random * opCodes.length);
  }

  static opcodeToSize(opcode) {
    // Instructions are ordered in 64, 8, 16, 32 bits size
    return [64, 8, 16, 32][opcode % 4];
  }

  static opcodeToAlignment(opcode) {
    // Instructions are ordered in 64, 8, 16, 32 bits size
    return [3, 0, 1, 2][opcode % 4];
  }

  static inputForSize(size) {
    if (size <= 32) {
      let random = Math.random();
      // Avoid 32 bit overflow for integer here :(
      return [Math.floor(random * (1 << (size - 1)) * 2), 0];
    }
    return [
      Math.floor(Math.random() * kMaxInt32),
      Math.floor(Math.random() * kMaxInt32)
    ];
  }

  static offsetForSize(size) {
    // Pick an offset in bytes between 0 and 8.
    let offset = Math.floor(Math.random() * 8);
    // Make sure the offset matches the required alignment by masking out the
    // lower bits.
    let size_in_bytes = size / 8;
    let mask = ~(size_in_bytes - 1);
    return offset & mask;
  }

  get wasmOpcode() {
    // [opcode, alignment, offset]
    return [
      opCodes[this.opcode], Operation.opcodeToAlignment(this.opcode),
      this.offset
    ];
  }

  get hasInput() {
    return this.opcode >= kFirstOpcodeWithInput;
  }

  get hasOutput() {
    return this.opcode < kFirstOpcodeWithoutOutput ||
        this.opcode > kLastOpcodeWithoutOutput;
  }

  truncateResultBits(low, high) {
    // print("low",low.toString(16),"high",high.toString(16),"offset",this.offset)
    if (this.size == 64)
      return [low, high]

    // Shift the lower part.
    // For offsets greater than 4(bytes), it drops out of the visible window.
    let shiftedL = this.offset >= 4 ? 0 : low >>> (this.offset * 8);
    // The higher part is zero for offset 0, left shifted for [1..3] and right
    // shifted for [4..7].
    let shiftedH = this.offset == 0 ?
        0 :
        this.offset >= 4 ? high >>> (this.offset - 4) * 8 : // No matching Lower half part
                           high << ((4 - this.offset) * 8); // To match Lower half part
    let value = shiftedL | shiftedH; // Matching
    // print("Value", value.toString(16))

    switch (this.size) {
      case 8:
        return [value & 0xFF, 0];
      case 16:
        return [value & 0xFFFF, 0];
      case 32:
        return [value, 0];
      default:
        throw 'Unexpected size: ' + this.size;
    }
  }

  static get builder() {
    if (!Operation.__builder) {
      let builder = new WasmModuleBuilder();
      builder.addImportedMemory('m', 'imported_mem', 0, kMaxMemPages, 'shared');
      Operation.__builder = builder;
    }
    return Operation.__builder;
  }

  static get exports() {
    if (!Operation.__instance) {
      return {};
    }
    return Operation.__instance.exports;
  }

  static get memory() {
    return Operation.exports.mem;
  }

  static set instance(instance) {
    Operation.__instance = instance;
  }

  compute(state) {
    let evalFun = Operation.exports[this.key];
    // print(evalFun)
    if (!evalFun) {
      let builder = Operation.builder;
      let body = [
        // Load address of low 32 bits.
        kExprI32Const, 0,
        // Load expected value.
        kExprLocalGet, 0, kExprI32StoreMem, 2, 0,
        
        // Load address of high 32 bits.
        kExprI32Const, 4,
        // Load expected value.
        kExprLocalGet, 1, kExprI32StoreMem, 2, 0,

        // Load address of where our window starts.
        kExprI32Const, 0,
        // Load input if there is one.
        ...(this.hasInput ?
                [
                  kExprLocalGet, 3, kExprI64UConvertI32, 
                  kExprI64Const, 32,
                  kExprI64Shl, 
                  kExprLocalGet, 2, kExprI64UConvertI32,
                  kExprI64Ior
                ] :
                []),

        // Perform operation.
        // wasmOpcode: [opcode, alignment, offset].
        kAtomicPrefix, ...this.wasmOpcode,

        // Drop output if it had any.
        ...(this.hasOutput ? [kExprDrop] : []),

        // Return.
        kExprReturn
      ]
      
      // Add and export function body.
      builder.addFunction(this.key, kSig_v_iiii)
          .addBody(body)
          .exportAs(this.key);
      
      // Instantiate module, get function exports.
      let module = new WebAssembly.Module(builder.toBuffer());

      // m? mapping? 
      Operation.instance =
          new WebAssembly.Instance(module, {m: {imported_mem: gPrivateMemory}});
      
      // Exports is "Insstace's 'readonly exports: Exports;'".
      evalFun = Operation.exports[this.key];
    }
    evalFun(state.low, state.high, this.low_input, this.high_input);
    let ta = gPrivateMemoryView;
    if (kDebug) {
      // print("truncate Called in compute")
      let tResult = this.truncateResultBits(this.low_input,this.high_input)
      // print(tResult)
      print(
          '\nState:\t' + state.high.toString(16) + ':' + state.low.toString(16) + 
          '\nOpera:\t[' +
          tResult[1].toString(16) +
          ':' + tResult[0].toString(16) +
          ']\t' + this.toString() +
          '\nNewSt:\t' + ta[1].toString(16) + ':' + ta[0].toString(16) + '\n');
    }
    return {low: ta[0], high: ta[1]};
  }
  get name(){
    return opCodeNames[this.opcode]
  }

  toString() {
    return opCodeNames[this.opcode] + '\t[+' + this.offset + '] ' +
        this.high_input.toString(16) + ':' + this.low_input.toString(16);
  }

  get key() {
    return this.opcode + '-' + this.offset;
  }
}



// Class State


class State {
  constructor(low, high, indices, count) {
    this.low = low;
    this.high = high;
    this.indices = indices;
    this.count = count;
  }

  isFinal() {
    return (this.count == kNumberOfWorker * kSequenceLength);
  }

  toString() {
    return this.count + '\n ' + this.high + ':' + this.low + '\n process:' + this.indices;
  }
}





// Global Methods




function makeSequenceOfOperations(size) {
  let result = new Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = new Operation();
  }
  return result;
}

function toSLeb128(low, high) {
  let result = [];
  while (true) {
    let v = low & 0x7f;
    // For low, fill up with zeros, high will add extra bits.
    low = low >>> 7;
    if (high != 0) {
      let shiftIn = high << (32 - 7);
      low = low | shiftIn;
      // For high, fill up with ones, so that we keep trailing one.
      high = high >> 7;
    }
    let msbIsSet = (v & 0x40) || false;
    if (((low == 0) && (high == 0) && !msbIsSet) ||
        ((low == -1) && (high == -1) && msbIsSet)) {
      result.push(v);
      break;
    }
    result.push(v | 0x80);
  }
  return result;
}

function generateFunctionBodyForSequence(sequence) {
  // We expect the int64* to perform ops on as arg 0 and
  // the int64* for our value log as arg1. Argument 2 gives
  // an int32* we use to count down spinning workers.
  let body = [];
  // Initially, we spin until all workers start running.
  if (!kDebug) {
    body.push(
        // Decrement the wait count.
        kExprLocalGet, 2, kExprI32Const, 1, kAtomicPrefix, kExprI32AtomicSub, 2,
        0,
        // Spin until zero.
        kExprLoop, kWasmStmt, kExprLocalGet, 2, kAtomicPrefix,
        kExprI32AtomicLoad, 2, 0, kExprI32Const, 0, kExprI32GtU, kExprBrIf, 0,
        kExprEnd);
  }
  for (let operation of sequence) {
    body.push(
        // Pre-load address of results sequence pointer for later.
        kExprLocalGet, 1,
        // Load address where atomic pointers are stored.
        kExprLocalGet, 0,
        // Load the second argument if it had any.
        ...(operation.hasInput ?
                [
                  kExprI64Const,
                  ...toSLeb128(operation.low_input, operation.high_input)
                ] :
                []),
        // Perform operation
        kAtomicPrefix, ...operation.wasmOpcode,
        // Generate fake output in needed.
        ...(operation.hasOutput ? [] : [kExprI64Const, 0]),
        // Store read intermediate to sequence.
        kExprI64StoreMem, 3, 0,
        // Increment result sequence pointer.
        kExprLocalGet, 1, kExprI32Const, 8, kExprI32Add, kExprLocalSet, 1);
  }
  // Return end of sequence index.
  body.push(kExprLocalGet, 1, kExprReturn);
  return body;
}

function getSequence(start, end) {
  return new Int32Array(
      gSharedMemory.buffer, start,
      (end - start) / Int32Array.BYTES_PER_ELEMENT);
}

function spawnWorkers() {
  let workers = [];
  for (let i = 0; i < kNumberOfWorker; i++) {
    let worker = new Worker(
        `onmessage = function(msg) {
            if (msg.module) {
              let module = msg.module;
              let mem = msg.mem;
              this.instance = new WebAssembly.Instance(module, {m: {imported_mem: mem}});
              postMessage({instantiated: true});
            } else {
              let address = msg.address;
              let sequence = msg.sequence;
              let index = msg.index;
              let spin = msg.spin;
              let result = instance.exports["worker" + index](address, sequence, spin);
	      postMessage({index: index, sequence: sequence, result: result});
            }
        }`,
        {type: 'string'});
    workers.push(worker);
  }
  return workers;
}

function instantiateModuleInWorkers(workers) {
  for (let worker of workers) {
    worker.postMessage({module: module, mem: gSharedMemory});
    let msg = worker.getMessage();
    if (!msg.instantiated) throw 'Worker failed to instantiate';
  }
}

function executeSequenceInWorkers(workers) {
  for (i = 0; i < workers.length; i++) {
    let worker = workers[i];
    worker.postMessage({
      index: i,
      address: 0,
      spin: 16,
      sequence: 32 + ((kSequenceLength * 8) + 32) * i
    });
    // In debug mode, keep execution sequential.
    if (kDebug) {
      let msg = worker.getMessage();
      results[msg.index] = getSequence(msg.sequence, msg.result);
    }
  }
}

function selectMatchingWorkers(state) {
  let matching = [];
  let indices = state.indices;
  for (let i = 0; i < indices.length; i++) {
    let index = indices[i];
    if (index >= kSequenceLength) continue;
    // We need to project the expected value to the number of bits this
    // operation will read at runtime.
    let [expected_low, expected_high] =
        sequences[i][index].truncateResultBits(state.low, state.high);
    let hasOutput = sequences[i][index].hasOutput;
    if (!hasOutput ||
        ((results[i][index * 2] == expected_low) &&
         (results[i][index * 2 + 1] == expected_high))) {
      matching.push(i);
    }
  }
  return matching;
}

function computeNextState(state, advanceIdx) {
  let newIndices = state.indices.slice();
  let sequence = sequences[advanceIdx];
  let operation = sequence[state.indices[advanceIdx]];
  newIndices[advanceIdx]++;
  let {low, high} = operation.compute(state);

  return new State(low, high, newIndices, state.count + 1);
}

function findSequentialOrdering() {
  let startIndices = new Array(results.length);
  let steps = 0;
  startIndices.fill(0);
  let matchingStates = [new State(0, 0, startIndices, 0)];
  while (matchingStates.length > 0) {
    let current = matchingStates.pop();
    // if (kDebug) {
    //   print('current state:\n', current);
    // }
    let matchingResults = selectMatchingWorkers(current);
    if (matchingResults.length == 0) {
      continue;
    } else {
      // print(' matching workers:',matchingResults);
    }
    
    for (let match of matchingResults) {
      let newState = computeNextState(current, match);
      if (newState.isFinal()) {
        print('[MYDBG] PASS at step:',steps)
        return true;
      }
      matchingStates.push(newState);
    }
    
    if (steps++ >= kNumberOfSteps) {
      print('Search timed out, aborting...');
      break;
    }
  }
  // We have no options left.
  print('[MYDBG] FAIL at step:',steps)

  return false;
}



// Debugging tools`


// Helpful for debugging failed tests.
function loadSequencesFromStrings(inputs) {
  let reverseOpcodes = {};
  for (let i = 0; i < opCodeNames.length; i++) {
    reverseOpcodes[opCodeNames[i]] = i;
  }
  let sequences = [];
  let parseRE = /([a-zA-Z0-9]*)\[\+([0-9])\] ([\-0-9]*)\:([\-0-9]*)/;
  for (let input of inputs) {
    let parts = input.split(',');
    let sequence = [];
    for (let part of parts) {
      let parsed = parseRE.exec(part);
      sequence.push(
          new Operation(reverseOpcodes[parsed[1]], parsed[4]| 0, parsed[3] | 0, parsed[2]| 0));
    }
    sequences.push(sequence);
  }
  return sequences;
}

// Helpful for debugging failed tests.
function loadResultsFromStrings(inputs) {
  let results = [];
  for (let input of inputs) {
    let parts = input.split(',');
    let result = [];
    for (let number of parts) {
      result.push(number | 0);
    }
    results.push(result);
  }
  return results;
}






// Main program





let sequences = [];
let results = [];

// opcode, low_input, high_input, offset
// [1,4,3,2]
// let failcase = [
//   'kExprI64AtomicSub16U[+6] 0:33346,kExprI64AtomicSub32U[+0] 0:-1780371402,kExprI64AtomicStore[+0] -210676296:-218378269,kExprI64AtomicAnd32U[+4] 0:-3896469060,kExprI64AtomicAdd8U[+7] 0:168',
//   'kExprI64AtomicStore[+0] -2186975459:-3530762299,kExprI64AtomicSub8U[+0] 0:32,kExprI64AtomicStore32U[+0] 0:-2941226281,kExprI64AtomicAnd16U[+0] 0:39026,kExprI64AtomicStore16U[+4] 0:6885',
//   'kExprI64AtomicAdd32U[+0] 0:-561519057,kExprI64AtomicStore16U[+0] 0:26424,kExprI64AtomicOr8U[+2] 0:6,kExprI64AtomicExchange8U[+5] 0:185,kExprI64AtomicExchange32U[+0] 0:-2291282342',
//   'kExprI64AtomicExchange16U[+6] 0:43903,kExprI64AtomicSub8U[+3] 0:55,kExprI64AtomicStore8U[+7] 0:84,kExprI64AtomicAdd32U[+4] 0:-2147187638,kExprI64AtomicExchange16U[+0] 0:31914'
// ]

// let failcase = [
//   'kExprI64AtomicSub16U[+6] 0:33346,kExprI64AtomicSub32U[+0] 0:-1780371402,kExprI64AtomicStore[+0] -210676296:-218378269,kExprI64AtomicAnd32U[+4] 0:-3896469060,kExprI64AtomicAdd8U[+7] 0:168',

// ]
let failcase = [
  'kExprI64AtomicSub16U[+6] 0:33346',

]
kNumberOfWorker = failcase.length
let builder = new WasmModuleBuilder();
builder.addImportedMemory('m', 'imported_mem', 0, kMaxMemPages, 'shared');

// Load test sequence
// sequences = loadSequencesFromStrings(failcase)
// kSequenceLength = sequences[0].length
for (let i = 0; i < kNumberOfWorker; i++) {
  print('Worker:', i)
  sequences[i] = makeSequenceOfOperations(kSequenceLength);
  
  print('Sequence:')

  for (let j = 0; j<kSequenceLength; j++){
    print('', sequences[i][j])
  }
  builder.addFunction('worker' + i, kSig_i_iii)
      .addBody(generateFunctionBodyForSequence(sequences[i]))
      .exportAs('worker' + i);
  // break
}

// Instantiate module, get function exports.
print("[MYDBG]Initializing")
let module = new WebAssembly.Module(builder.toBuffer());
let instance =
    new WebAssembly.Instance(module, {m: {imported_mem: gSharedMemory}});

// Spawn off the workers and run the sequences.
let workers = spawnWorkers();
// Set spin count.
gSharedMemoryView[4] = kNumberOfWorker;
instantiateModuleInWorkers(workers);

print("[MYDBG]Executing")
executeSequenceInWorkers(workers);

print("[MYDBG]Collecting")
if (!kDebug) {
  // Collect results, d8 style.
  for (let worker of workers) {
    let msg = worker.getMessage();
    results[msg.index] = getSequence(msg.sequence, msg.result);
  }
}

// Terminate all workers.
for (let worker of workers) {
  worker.terminate();
}

print("[MYDBG]Results")
for (let i = 0; i < kNumberOfWorker; i++) {
  print('Worker ' + i + ' :[ high : low ]');
  // print(sequences[i]);
  for (let j = 0; j < kSequenceLength; j++){
    print('[',results[i][2*j].toString(16).padStart(8,'0'),':',
    results[i][2*j+1].toString(16).padStart(8,'0'),']')
  }
}


// Try to reconstruct a sequential ordering.
print("[MYDBG]Re-constructing")
let passed = findSequentialOrdering();



if (passed) {
  print('PASS');
  } else {
  print('FAIL');
  quit(-1);
}

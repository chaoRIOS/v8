#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
$DIR/../tools/run-tests.py --outdir=out/riscv64.sim cctest \
                                                    unittests \
                                                    wasm-api-tests \
                                                    mjsunit \
                                                    intl \
                                                    message \
                                                    debugger \
                                                    inspector \
                                                    mkgrokdump

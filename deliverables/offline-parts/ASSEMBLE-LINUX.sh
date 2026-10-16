#!/bin/sh
set -eu
cd "$(dirname "$0")"
cat 'paired-linux-x64-offline.zip.part01' 'paired-linux-x64-offline.zip.part02' > 'paired-linux-x64-offline.zip'
printf '%s\n' 'c5defad2ce0680e8815b0f20e45357b42db54dd88e195490d80ade03fb9a981c  paired-linux-x64-offline.zip' | sha256sum -c -
printf '%s\n' 'Extract the complete ZIP, then open SSH-Relay-Near or Far.'

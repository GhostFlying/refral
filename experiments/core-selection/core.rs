#![no_std]

use core::panic::PanicInfo;
use core::ptr::{addr_of, addr_of_mut};

const MAX_COMMANDS: usize = 8192;
const COMMAND_WORDS: usize = 8;
const RECORD_WORDS: usize = 12;
const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;

static mut COMMANDS: [u32; MAX_COMMANDS * COMMAND_WORDS] = [0; MAX_COMMANDS * COMMAND_WORDS];
static mut PAYLOAD: [u8; MAX_PAYLOAD_BYTES] = [0; MAX_PAYLOAD_BYTES];
static mut OUTPUT: [u32; MAX_COMMANDS * RECORD_WORDS] = [0; MAX_COMMANDS * RECORD_WORDS];
static mut CORE: State = State::new();

struct State {
    color: [u32; 4],
    pipeline: u32,
    layout: u32,
    storage_generation: u32,
    content_version: u32,
    buffer_checksum: u32,
    uploaded_bytes: u32,
    payload_length: usize,
    output_words: usize,
    pipeline_cache: [bool; 256],
    pipeline_misses: u32,
    error: u32,
}

impl State {
    const fn new() -> Self {
        Self {
            color: [0, 0, 0, 255],
            pipeline: 0,
            layout: 0,
            storage_generation: 0,
            content_version: 0,
            buffer_checksum: 0,
            uploaded_bytes: 0,
            payload_length: 0,
            output_words: 0,
            pipeline_cache: [false; 256],
            pipeline_misses: 0,
            error: 0,
        }
    }

    fn execute(&mut self, operation: u32, args: [u32; 7]) {
        match operation {
            1 => self.color.copy_from_slice(&args[..4]),
            2 if args[0] < 32 => self.pipeline = args[0],
            3 if args[0] < 8 => self.layout = args[0],
            4 => {
                self.storage_generation = self.storage_generation.wrapping_add(1);
                self.content_version = self.content_version.wrapping_add(1);
                self.buffer_checksum = 0;
            }
            5 => {
                let start = args[0] as usize;
                let length = args[1] as usize;
                if start > self.payload_length || length > self.payload_length - start {
                    self.error = 2;
                    return;
                }
                let bytes = unsafe {
                    core::slice::from_raw_parts(addr_of!(PAYLOAD).cast::<u8>().add(start), length)
                };
                let mut checksum = 2166136261_u32;
                for &byte in bytes {
                    checksum = (checksum ^ u32::from(byte)).wrapping_mul(16777619);
                }
                self.buffer_checksum = checksum;
                self.content_version = self.content_version.wrapping_add(1);
                self.uploaded_bytes = self.uploaded_bytes.wrapping_add(length as u32);
            }
            6 => {
                if self.output_words + RECORD_WORDS > MAX_COMMANDS * RECORD_WORDS {
                    self.error = 3;
                    return;
                }
                let key = (self.pipeline * 8 + self.layout) as usize;
                if !self.pipeline_cache[key] {
                    self.pipeline_cache[key] = true;
                    self.pipeline_misses += 1;
                }
                let record = [
                    self.color[0],
                    self.color[1],
                    self.color[2],
                    self.color[3],
                    self.pipeline,
                    self.layout,
                    self.storage_generation,
                    self.content_version,
                    self.buffer_checksum,
                    self.uploaded_bytes,
                    self.pipeline_misses,
                    (self.output_words / RECORD_WORDS) as u32,
                ];
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        record.as_ptr(),
                        addr_of_mut!(OUTPUT).cast::<u32>().add(self.output_words),
                        RECORD_WORDS,
                    );
                }
                self.output_words += RECORD_WORDS;
            }
            _ => self.error = 1,
        }
    }
}

#[no_mangle]
pub extern "C" fn commands_pointer() -> *mut u32 {
    addr_of_mut!(COMMANDS).cast::<u32>()
}

#[no_mangle]
pub extern "C" fn payload_pointer() -> *mut u8 {
    addr_of_mut!(PAYLOAD).cast::<u8>()
}

#[no_mangle]
pub extern "C" fn output_pointer() -> *const u32 {
    addr_of!(OUTPUT).cast::<u32>()
}

#[no_mangle]
pub extern "C" fn output_words() -> usize {
    unsafe { (*addr_of!(CORE)).output_words }
}

#[no_mangle]
pub extern "C" fn status() -> u32 {
    unsafe { (*addr_of!(CORE)).error }
}

#[no_mangle]
pub extern "C" fn reset(payload_length: usize) -> u32 {
    unsafe {
        *addr_of_mut!(CORE) = State::new();
        let state = &mut *addr_of_mut!(CORE);
        if payload_length > MAX_PAYLOAD_BYTES {
            state.error = 2;
        } else {
            state.payload_length = payload_length;
        }
        state.error
    }
}

#[no_mangle]
pub extern "C" fn command(operation: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32) {
    unsafe { (&mut *addr_of_mut!(CORE)).execute(operation, [a, b, c, d, e, f, g]) }
}

#[no_mangle]
pub extern "C" fn replay(command_count: usize, payload_length: usize) -> u32 {
    if reset(payload_length) != 0 {
        return status();
    }
    if command_count > MAX_COMMANDS {
        unsafe { (*addr_of_mut!(CORE)).error = 2 };
        return status();
    }
    for index in 0..command_count {
        let offset = index * COMMAND_WORDS;
        let words = unsafe {
            core::slice::from_raw_parts(addr_of!(COMMANDS).cast::<u32>().add(offset), COMMAND_WORDS)
        };
        command(
            words[0], words[1], words[2], words[3], words[4], words[5], words[6], words[7],
        );
    }
    status()
}

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

// Chromium component builds link ANGLE's internal entry points statically.
extern "C" {
using Proc = void (*)();
Proc EGL_GetProcAddress(const char*);
Proc rfAngleProc(const char* name) { return EGL_GetProcAddress(name); }
}

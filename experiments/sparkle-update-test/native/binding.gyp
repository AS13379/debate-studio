{
  "targets": [
    {
      "target_name": "sparkle_bridge",
      "sources": ["src/sparkle_bridge.mm"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "OTHER_CFLAGS": ["-ObjC++", "-F<(module_root_dir)/vendor"],
        "FRAMEWORK_SEARCH_PATHS": ["<(module_root_dir)/vendor"],
        "OTHER_LDFLAGS": [
          "-F<(module_root_dir)/vendor",
          "-framework Sparkle",
          "-Wl,-rpath,@loader_path/../Frameworks"
        ]
      }
    }
  ]
}

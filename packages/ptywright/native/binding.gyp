{
  "targets": [
    {
      "target_name": "ptywright_native",
      "sources": [
        "src/addon.cc",
        "src/ghostty_bridge.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<!(node -p \"require('../scripts/ghostty-config.cjs').includeDir\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "conditions": [
        [
          "OS=='linux'",
          {
            "libraries": [
              "-L<!(node -p \"require('../scripts/ghostty-config.cjs').libDir\")",
              "-lghostty-vt"
            ],
            "ldflags": [
              "-Wl,-rpath,<!(node -p \"require('../scripts/ghostty-config.cjs').libDir\")"
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "libraries": [
              "<!(node -p \"require('../scripts/ghostty-config.cjs').dylibPath\")"
            ],
            "xcode_settings": {
              "OTHER_LDFLAGS": [
                "-Wl,-rpath,<!(node -p \"require('../scripts/ghostty-config.cjs').libDir\")"
              ],
              "GCC_ENABLE_CPP_EXCEPTIONS": "NO"
            }
          }
        ]
      ]
    }
  ]
}

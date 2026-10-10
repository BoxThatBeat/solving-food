{
  description = "Solving Food — dev shell (Firebase CLI, gcloud, Java for the emulators)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            firebase-tools      # firebase CLI (deploy, emulators, apps:sdkconfig, functions:secrets:set)
            google-cloud-sdk    # gcloud (Storage drop folder, Cloud Tasks, budgets)
            jdk21_headless      # the Firebase Emulator Suite needs a JRE
            playwright-driver.browsers   # Chromium, Firefox, WebKit for the e2e suite (pin @playwright/test to this driver's version)
          ];

          shellHook = ''
            export CLOUDSDK_CORE_PROJECT=solvingfood
            # Keep firebase-tools from phoning home about updates inside the shell.
            export FIREBASE_TOOLS_NO_UPDATE_NOTIFIER=1
            # Playwright on NixOS: use the nixpkgs browsers, never `playwright install`.
            # @playwright/test in e2e/package.json is pinned to ${pkgs.playwright-driver.version}.
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            # Same fallback fonts on every machine (NixOS laptop, Ubuntu CI runner), so screenshots match.
            export FONTCONFIG_FILE=${pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; }}
          '';
        };
      });
    };
}

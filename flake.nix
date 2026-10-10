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
          ];

          shellHook = ''
            export CLOUDSDK_CORE_PROJECT=solvingfood
            # Keep firebase-tools from phoning home about updates inside the shell.
            export FIREBASE_TOOLS_NO_UPDATE_NOTIFIER=1
          '';
        };
      });
    };
}

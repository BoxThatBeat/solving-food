# Delivering files to the drop folder

The drop folder is `recipe-drop/<uid>/` in the app's Storage bucket `solvingfood.firebasestorage.app`, where
`<uid>` is the Firebase user ID of the person importing. Each `.cook` file there is imported within seconds and
then deleted; the result (success, "looks like a duplicate", or the error) appears as a banner in the app for that
user.

## Option 1: upload from a terminal (project owner)

Requires the Google Cloud CLI signed in as the project owner (`gcloud auth list` shows the owner's account; the
Solving Food dev shell sets the project). The in-app Drop page shows the exact command with the signed-in user's
uid filled in; it looks like:

```sh
gcloud storage cp garlic-rice-and-chicken.cook gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/
```

With a photo that is a local file (front matter `image: garlic-rice.jpg`), upload the photo **first**, then the
`.cook`, to the same folder:

```sh
gcloud storage cp garlic-rice.jpg garlic-rice-and-chicken.cook gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/
```

The importer matches the photo by file name (spaces are fine) and waits up to 30 seconds for it. Photos with no
matching recipe are swept after a day.

For many files from the repo, `pnpm drop:recipes -- --email <address>` uploads a folder of `.cook` files with their
photos a couple at a time and waits for each import.

Find a user's uid in the Drop page's command, or in the Firebase console (Authentication → Users).

## Option 2: save the files for the user

Save the `.cook` file (and any photo it names) to a folder the user can reach, and tell them to open
**Recipes → + Add recipe → Drop folder** (or `/drop`) in Solving Food and drag the files in (or use
**Choose files**). Several files can go at once; drop each photo together with its recipe.

## Images

- Prefer a **direct image URL** in `image:` (the `og:image` of a recipe page, or the main photo's `src`). The
  importer downloads it, stores it in three sizes, and never hot-links it. If the download fails the recipe is still
  imported, and the banner says the image couldn't be saved.
- For a photographed recipe, the photo itself can be the recipe image: upload it alongside and use its file name.

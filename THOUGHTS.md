Solving Food: This app idea is mainly based on the fact that I can now give ChatGPT a grocer list and it will automatically add those items to my grocery store cart and then get delivered to our house regularly. The app will show saved recipes and let the user select the recipes they will make in the week beforehand. Once the week is planned, a full grocery list is automatically given (the user copies the grocery list, pastes it into ChatGPT which has a plugin that allows the LLM to order all these groceries for the user). The server adds these groceries to a stored inventory. Then in the week, the user clicks on the days meal and sees a user friendly recipe with a step view mode. When the user is done eating they will press finished cooking on that open recipe and insert their score out of 10, and modify the number of ingredients used (if deviated from recipe). The server will then subtract the ingredients of that recipe from the inventory. The next week, the main recipes shown will involve the ingredients that are going bad the most and most likely to expire. When building the list of chosen recipes, a budget is shown and goes down as recipes are added.

- 
- user can change the accent color of catppuccin
- After the meal confirmation, ask if the estimated number of leftover lunches is correct and have up and down arrows to adjust
- should be able to select multiple recipes for one meal
- Should support having one recipe that covers multiple lunches or breakfasts (meal prepping) and can go past one week
- Need to keep track of inventory automatically based on what meals were made and what groceries were bought: the hard part being conversion of weight and volume (cups) and other units
- Can source a lot of recipes from sites using a web scrapper that just gives the link to an LLM to then make a recipe from and store on the server
- Use the recipe format that is readable by Ai
- Important idea: you dont need to have 20 scales for the llm to know how much left of ingredients. Instead, assume that what it buys from the grocery store - what is required by the meals for the week. If we ever deviate then we should be able to correct what we used. When we finish a meal, we check off that we did in fact make it, then review it, and add or remove ingredients we used.
- Can show only meals that would use up what is left
- Ingredients should be marked with their expected expiry dates
- Can always modify current assumed inventory
- Could have the server live on a raspberry pi and then my wife can also see the data
- Have a visible budget that gets used up when choosing meals
- always show the inventory of a specific ingredient beside the ingredients list in the recipes when viewing them
- Always store the amounts as weight, not number of potatoes (never store an amount if possible)
- Show meals chosen in a list for the week and if you dont eat them all, it assumes they will be in the next week.
- Copy the list of groceries to chatgpt to order them
- If you ever cant make a recipe because of inventory, make it greyed out
- Can run the server on raspebrry pi at home
- Make a claude skill for adding cooklang recipes and include how to write in that lang
- Make the database server in Rust. Just a REST API. The frontend in React (single page application)
- Recipes should also be editable
- Good searching, filtering for recipes
- Take screenshots of obsidian database and recipe app for UI inspo
- Three pages: Inventory, Recipes, History, Plan, (selected recipes for the week)
- Need database backups to different connected harddrive
- Need to have a page that lets the user create a mapping from ingredient -> preferred brand (which is what will actually be put in the grocery list so that the specific brand of an ingredient is ordered from the grocery store)
- Have a way to manually add a recipe that has: ingredients, images, steps. But should also have an API and claude skill to allow an LLM to create a recipe given a link to a recipe website
- Meals (collection of recipes) should not be tied to a specific day. 
- Have the list of recipes be public but have accounts to allow multiple tenets who have their own inventory and planned meals. The sign in system should be simple passwordless email based
- I need to know where I source food from: meat always from Costco
- Need to be able to say the meal yielded x lunches as leftovers
- Should have the same sorting and filtering component for viewing chosen meals as well
- Need to dedupe recipes
- Ability to easily share a recipe or meal (collection of recipes)
- Should be able to save meals as a separate list than the recipes
- PWA app using react and shadcn
- Should be able to click on an inventory item and see its transactions that made the number the user sees
- Should have multiple users in one household, multiple housholds. Households share ratings, meal plans. Every user shares the list of searchable recipes,
- UI can show You’ve made this recipe 14 times.
- could have a way to ask for dinners below x$ which the optimizer finds recipes that share ingredients but also are not all the same cuisine
- If an ingredient used in a recipe is going to expire within the week, such as salmon, this should be brought to the attention of the user and ways of using it all should be presented (meals that use more salmon
- Should be able to tell the system we have frozen an ingredient, greatly prolonging its lifespan (include two estimates of expiry in the table)
- there should be a recipe drop folder, when a recipe cooklang file is added, it is watched and picked up for processing (generated by llm)
- How will I handle the fact that we buy groceries from Costco too
- Add favoriting meals. Then when I add our family recipes, favourite them
- Mise en place? 
- Can I use Jev for smart something in the app?
- Should build a cadence for how quickly we use parachables. The app can ask if we are out of something and add it to the grocery list. Should be able to always manually add to the grocery list too
- Can always take a picture of a recipe and add those to the inventory
- in the inventory page, show the current value and then in brackets what will be left after all planned meals are made
- You should be able to mark off what was eating, 
- user configures what tools that you have in the kitchen 
- Backups of the database can be separate from the app
- Compare cooklang vs schema.org/recipe
- Mobile friendly
- Should be able to tell the system what foods we like best.
- Call it a supply, not inventory
- Use brutalism style and Catppuccin theme
- Use Firebase to host the app and firebase for users and database (not SQL)

Recipe Suggestion Page:
Recipe Score =
    expiry urgency
  + inventory utilization
  + user rating
  + historical preference
  + nutritional goals
  + preparation time
  + variety
  - -missing ingredients
  - -cost
  - -same meat as other chosen meals
  - -same cuisine as other chosen meals

Can configure the weights of all these scores


Important goal: minimize the requirement for a user to manually edit the inventory as much as possible
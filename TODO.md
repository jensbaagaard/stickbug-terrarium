# TODO

## new bugs
- [x] lets add lady bugs with genome, and lets give them an unique and extensive ai like fish and stickbugs
- lets add butterflys with genome, and lets give them an unique and extensive ai like fish and stickbugs
    - i want them to land on flowers, creating pollen sparkles as they pollinate

## world building
- [x] lets add a bunch of random smaller bugs that can appear if conditions are met
    - small dragon fly's appearing over static lakes
    - rare bees apearing over flowers
        - after landing on a flower it should have visible pollen on its legs as before despawning
    - etc..
- [x] lets also make our random bugs and firefly count scale with the amount of plants, so the starting tank only has one but the sample tank has the maximum amount
- [x] its important we also look at how much air is in the tank forexample if its filled with water (a aquarium) we should not spawn any flying bugs. or if its 90% water only spawn a few

## biomes
- [x] lets add a biome calculator - e.g. if a world is mostly sand and sandstone its a dessert
    - a want a rare flower to be able to randomly grow if conditions are met
        - a white lotus very rarely should appear if its a dessert, and if no other lotus is present
        - come up with some more biomes and random events 

## shop
    - [x] lets add the textures to our editor tab
    - [x] lets also add some variant of darker stone og darker sandstone

## animated backrounds
    - [x] lets go though our backgrounds and add some rare random animations and general vibes
        - shooting stars to backgrounds that have stars
        - mist for backrounds with trees
        - clounds where it makes sense
        - etc. 

## full code review
- lets go though our code and optimize for further development. the most important part is to make our architecture optimized to use less context so we can better scope our new features.
    - seperate features so we dont read unnecceracy code
    - create archtecture .md files
    - remove dead code
    - optimizations
    - can we do something more clean
    - remove comments that are wrong, no not help. or are too verbose
    - a torough run though with testing of performance. what is out biggest pain points, can we do anything to speed things up
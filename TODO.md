# TODO

# flowers
- [x] lets add flower cyles from bulb to flower to dropping their pedals

# new bugs
- [x] lets add lady bugs with genome, and lets give them an unique and extensive ai like fish and stickbugs
- lets add butterflys with genome, and lets give them an unique and extensive ai like fish and stickbugs
    - i want them to land on flowers, creating pollen sparkles as they pollinate

# world building
- lets add a bunch of random smaller bugs that can appear if conditions are met
    - small dragon fly's appearing over static lakes
    - rare bees apearing over flowers
        - after landing on a flower it should have visible pollen on its legs as before despawning
    - etc..
- lets also make our random bugs and firefly count scale with the amount of plants, so the starting tank only has one but the sample tank has the maximum amount

# biomes
- lets add a biome calculator - e.g. if a world is mostly sand and sandstone its a dessert
    - a want a rare flower to be able to randomly grow if conditions are met
        - a white lotus very rarely should appear if its a dessert, and if no other lotus is present
        - come up with some more biomes and random events 

# full code review
- lets go though our code and optimize for further development. the most important part is to make our architecture optimized to use less context so we can better scope our new features.
    - seperate features so we dont read unnecceracy code
    - create archtecture .md files
    - remove dead code
    - optimizations
    - can we do something more clean
    - remove comments that are wrong, no not help. or are too verbose
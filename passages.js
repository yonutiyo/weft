// Helpers
function link(to, text, attrs = "") {
  return `<a href="#" data-goto="${to}" ${attrs}>${text}</a>`;
}
function setOnly(setStr, text, attrs = "") {
  return `<a href="#" data-set="${setStr}" ${attrs}>${text}</a>`;
}
function passage(title, paragraphs, linksHtmlArray) {
  const body = paragraphs.map(p => `<p>${p}</p>`).join("");
  const nav  = linksHtmlArray.join("");
  return `<h1>${title}</h1>${body}<nav>${nav}</nav>`;
}

// Content (state examples kept; Reputation line removed from main text)
export const passages = {
  start: passage(
    "The Crossroads",
    [
      "Dirt paths meet beneath a leaning signpost. Wind tugs at the edges of an old map.",
      `<span data-if="hasMap">You tuck the map into your pack.</span>
       <span data-unless="hasMap">A sun-faded map lies half-buried near your boot.</span>`
      // (No "Reputation: {{rep}}" here—shown only in the sidebar)
    ],
    [
      setOnly("hasMap=true", "Pick up the map", `data-unless="hasMap"`),
      setOnly("rep+=1", "Help a passerby"),
      setOnly("rep-=1", "Ignore the passerby"),
      link("clearing", "Take the forest path"),
      link("camp",     "Follow the smoke"),
      link("river",    "Head toward the river")
    ]
  ),

  clearing: passage(
    "Forest Clearing",
    [
      "Sunlight pools on soft grass. A ring of mushrooms forms a pale crescent.",
      `<span data-unless="hasTorch">The root-cave ahead is pitch-black without a torch.</span>
       <span data-if="hasTorch">Your torch bites back the dark.</span>`
    ],
    [
      link("cave", "Enter the root-cave", `data-if="hasTorch"`),
      setOnly("hasTorch=true", "Take a fallen branch for a torch", `data-unless="hasTorch"`),
      link("start", "Return to the crossroads")
    ]
  ),

  camp: passage(
    "Abandoned Camp",
    [
      "A kettle hangs cold above ash. Footprints circle the site and vanish at the edge of brush.",
      `<span data-if="rep==0">The camp feels indifferent to your presence.</span>
       <span data-if="rep>0">You find a folded note: “Thank you.”</span>
       <span data-if="rep<0">You feel watched.</span>`
    ],
    [
      link("river", "Follow the prints toward water"),
      link("start", "Back to the crossroads")
    ]
  ),

  river: passage(
    "River Bend",
    [
      "The river mouths along a gravel bar, green and glassy. A narrow trail follows the bank.",
      "Broken reeds suggest someone came through at haste."
    ],
    [
      link("clearing", "Cut back through the trees"),
      link("camp",     "Trace the prints upriver"),
      link("start",    "Return to the crossroads")
    ]
  ),

  cave: passage(
    "Root-Cave Mouth",
    [
      "A cool breath leaks from the earth. The tunnel narrows quickly, then widens beyond a bend.",
      `<span data-unless="hasTorch">Without a torch, this is a bad idea.</span>`
    ],
    [
      link("clearing", "Back to the clearing"),
      link("start",    "Back to the crossroads")
    ]
  )
};

// Author-facing config only. No engine changes needed.
// You control which variables are shown and when.
export default {
  title: "Journal",
  position: "left",   // left sidebar
  width: 260,         // px
  // Show the sidebar except on a "splash" passage (customize if needed)
  when: "id!='splash' || hasMap",
  items: [
    { key: "rep",      label: "Reputation", format: "number",    when: "rep!=0" },
    { key: "hasMap",   label: "Map",        format: "boolYesNo", when: "hasMap" },
    { key: "hasTorch", label: "Torch",      format: "boolIcon",  when: "hasTorch" }
  ]
};

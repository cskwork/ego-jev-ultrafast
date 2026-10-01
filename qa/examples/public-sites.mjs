// Example QA scenarios on public sites. Run:
//   node qa/run.mjs qa/examples/public-sites.mjs --out /tmp/jego-qa
//   node qa/report.mjs /tmp/jego-qa --open
export const meta = { title: "Jego QA example: public sites", env: "Wikipedia, Hacker News", lang: "en" };

export const scenarios = [
  {
    id: "wiki-search",
    title: "Search Wikipedia and open a book article",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    goal: "Search Wikipedia for 'Gödel, Escher, Bach' and open the article about the book",
    expect: ["Douglas Hofstadter"],
  },
  {
    id: "hn-comments",
    title: "Open the top Hacker News story's comments",
    url: "https://news.ycombinator.com",
    goal: "Open the comments page of the top-ranked story",
    expectUrl: "item?id=",
  },
];

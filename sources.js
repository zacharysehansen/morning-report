// The sources scraped for the daily digest. Each becomes one agent call.
//
//   label        - category name shown in the digest / used as the merge key
//   prompt       - what the agent is asked to fetch and return
//   requiredKeys - keys every returned object must contain (schema validation)
//
// Add, remove, or re-point a source by editing this list only.

export const sources = [
  // Verified 2026-08-07: reachable from the agent host with opencode's own
  // fetch, and the served HTML carries direct /e/<slug> links per event.
  // Alternative if this ever starts failing — a local calendar, a quarter the
  // page weight, with .../Event?oid=... links per event:
  //   https://community.tucsonweekly.com/tucson/EventSearch?eventCategory=1107701&sortType=date&v=d
  {
    label: "Live Music",
    prompt:
      "please use the web fetch tool to look at https://www.eventbrite.com/d/az--tucson/music-events/ and then tell me any events that are happening in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  // Verified 2026-09-27 via curl: 200, server-rendered, direct /e/<slug> links
  // in the raw HTML, same pattern as the music-events source above.
  {
    label: "Arts",
    prompt:
      "please use the web fetch tool to look at https://www.eventbrite.com/d/az--tucson/arts/ and then tell me any events that are happening in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  // Verified 2026-09-27 via curl: both category pages return 200 and carry
  // direct /e/<slug> links. One source, two fetches — ask the agent to check
  // both and merge, the same way it already fans out across venues for the
  // Rialto source below.
  {
    label: "Outdoors & Community",
    prompt:
      "please use the web fetch tool to look at https://www.eventbrite.com/d/az--tucson/outdoor-events/ AND https://www.eventbrite.com/d/az--tucson/community/, then tell me any events from either page that are happening in the next few weeks. Please format this as a single array of JSON object with keys of event, date, and url, combining results from both pages. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  {
    label: "Meetups",
    prompt:
      "please use the web fetch tool to look at https://www.meetup.com/find/?source=EVENTS&location=us--az--Tucson and then tell me what events are happening in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  {
    label: "At the Loft",
    prompt:
      "please use the web fetch tool to look at https://loftcinema.org and then tell me what movies are playing in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. The url MUST be the direct link to that specific movie's own page on loftcinema.org (not the homepage, a calendar page, or a ticketing link) — follow the link for each movie to get its individual URL. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  // Verified 2026-09-27 with a live webfetch call (not curl — curl gets
  // Cloudflare's "Just a moment" challenge here, but opencode's own fetch gets
  // through, same as loftcinema.org). Confirmed real, upcoming events with
  // working ticketmaster-style URLs. This calendar also covers 191 Toole, Fox
  // Tucson Theatre, Hotel Congress, Linda Ronstadt Music Hall, and R Bar — one
  // source, several venues. Heaviest page of the sources (~750KB), so it can
  // take an extra retry to resolve; that's expected, not a sign it's broken.
  {
    label: "At the Rialto",
    prompt:
      "please use the web fetch tool to look at https://www.rialtotheatre.com/calendar and then tell me what shows are happening in the next few weeks (this calendar also covers 191 Toole, Fox Tucson Theatre, Hotel Congress, Linda Ronstadt Music Hall, and R Bar). Please format this as an array of JSON object with keys of event, date, and url. The url MUST be the direct link to that specific show's own page. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  {
    label: "At the U of A",
    prompt:
      "please use the web fetch tool to look at https://news.arizona.edu/calendar and then tell me what interesting events, talks, lectures, and exhibitions are happening in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. The url MUST be the direct link to that specific event's own page on arizona.edu (not the calendar page or homepage) — follow the link for each event to get its individual URL. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  {
    label: "Campus Rec",
    prompt:
      "please use the web fetch tool to look at https://rec.arizona.edu/calendar and then tell me what interesting events, classes, and activities are happening in the next few weeks. Please format this as an array of JSON object with keys of event, date, and url. The url MUST be the direct link to that specific event's own page on rec.arizona.edu (not the calendar page or homepage) — follow the link for each event to get its individual URL. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["event", "date", "url"],
  },
  {
    label: "Projects to Explore",
    prompt:
      "please use the web fetch tool to look at https://github.com/topics/awesome and then pick at random 10 projects in the list that would be interesting to learn more about. Please format this as an array of JSON object with keys of project, description, and url. I JUST want the array of JSON objects, nothing else",
    requiredKeys: ["project", "description", "url"],
  },
];

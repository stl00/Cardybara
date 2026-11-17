// The plain web app, and `npm run dev`. A capability the web lacks is absent, not faked: there is no `collection`, no
// `assistant` and no notification worker here. Web push is added to `notifications` by its own issue.
export const web={
 kind:'web',
 notifications:{worker:false}
};
// `npm run dev` serves the same page with a bridge script the dev server injects, so collection exists but needs no start-up here.
export const dev={
 ...web,
 kind:'dev',
 collection:{start(){}}
};
export default web;

// backend/storiesRoutes.js
const { stories, users } = require("./db");
const { v4: uuidv4 } = require("uuid");

function install(app) {
  // list stories for user
  app.get("/api/users/:id/stories", (req, res) => {
    const uid = req.params.id;
    const list = Array.from(stories.values()).filter(s => s.userId === uid);
    res.json(list);
  });

  // add story
  app.post("/api/users/:id/stories", (req, res) => {
    const uid = req.params.id;
    const { title, text } = req.body || {};
    if (!title || !text) return res.status(400).json({ error: "Missing title/text" });
    if (!users.has(uid)) return res.status(404).json({ error: "User not found" });
    const id = "s_" + uuidv4();
    const story = { id, userId: uid, title, text, createdAt: Date.now() };
    stories.set(id, story);
    res.status(201).json(story);
  });

  // update story
  app.put("/api/stories/:sid", (req, res) => {
    const { sid } = req.params;
    const story = stories.get(sid);
    if (!story) return res.status(404).json({ error: "Story not found" });
    const { title, text } = req.body || {};
    if (title) story.title = title;
    if (text) story.text = text;
    stories.set(sid, story);
    res.json(story);
  });

  // delete story
  app.delete("/api/stories/:sid", (req, res) => {
    const { sid } = req.params;
    if (!stories.has(sid)) return res.status(404).json({ error: "Story not found" });
    stories.delete(sid);
    res.status(204).end();
  });
}

module.exports = { install };

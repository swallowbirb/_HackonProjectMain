const promptService = require('./prompt.service');

/** GET /api/prompts — list base + category prompts (admin). */
const listPrompts = async (req, res, next) => {
  try {
    const prompts = await promptService.listPrompts();
    return res.status(200).json({ success: true, data: prompts });
  } catch (error) {
    return next(error);
  }
};

/** PUT /api/prompts — upsert a base/category prompt (admin). */
const upsertPrompt = async (req, res, next) => {
  try {
    const { scope, key, content, label, enabled } = req.body || {};
    if (!['base', 'category'].includes(scope)) {
      return res.status(400).json({ success: false, message: "scope must be 'base' or 'category'" });
    }
    const saved = await promptService.upsertPrompt({
      scope, key, content, label, enabled, userId: req.user?._id,
    });
    return res.status(200).json({ success: true, data: saved });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

/** POST /api/prompts/reset — reset a prompt to its shipped default (admin). */
const resetPrompt = async (req, res, next) => {
  try {
    const { scope, key } = req.body || {};
    const saved = await promptService.resetPrompt({ scope, key, userId: req.user?._id });
    return res.status(200).json({ success: true, data: saved });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

module.exports = { listPrompts, upsertPrompt, resetPrompt };

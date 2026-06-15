const promptService = require('./prompt.service');

/** GET /api/prompts — list base + category + template prompts (admin). */
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
    if (!['base', 'category', 'template'].includes(scope)) {
      return res.status(400).json({ success: false, message: "scope must be 'base', 'category', or 'template'" });
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

/** DELETE /api/prompts/category — remove an admin-added category overlay (admin). */
const deleteCategory = async (req, res, next) => {
  try {
    const key = req.body?.key ?? req.query?.key;
    const result = await promptService.deleteCategory({ key });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

module.exports = { listPrompts, upsertPrompt, resetPrompt, deleteCategory };

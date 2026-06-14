const uploadsService = require('./uploads.service');

const getPresignedUrl = async (req, res, next) => {
  try {
    const { fileName, contentType, itemId } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'fileName and contentType are required',
      });
    }

    const result = await uploadsService.generatePresignedUrl({ fileName, contentType, itemId });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPresignedUrl };

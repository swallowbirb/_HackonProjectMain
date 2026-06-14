const mongoose = require('mongoose');
const { TRUST_SIGNALS } = require('../../contracts/trustProfile.contract');

// Contract signals + the manual fraud signals the /signals endpoint accepts.
const KNOWN_SIGNALS = [
  ...Object.keys(TRUST_SIGNALS),
  'REVERSE_IMAGE_HIT',
  'EXIF_ANOMALY',
  'PHOTO_OF_SCREEN',
  'TIME_TO_RETURN_ANOMALY',
  'LOCKER_WEIGHT_MISMATCH',
];

const validateUserId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(400).json({ success: false, message: 'Invalid userId' });
  }
  next();
};

const validateSignal = (req, res, next) => {
  const { signal, direction } = req.body;
  if (!signal || !KNOWN_SIGNALS.includes(signal)) {
    return res.status(400).json({ success: false, message: 'Unknown or missing signal' });
  }
  if (direction && !['positive', 'negative'].includes(direction)) {
    return res.status(400).json({ success: false, message: 'direction must be positive|negative' });
  }
  next();
};

module.exports = { validateUserId, validateSignal };

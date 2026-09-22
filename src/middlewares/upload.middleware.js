const multer = require('multer');
const AppError = require('../utils/app-error');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file || !file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new AppError('Only image files are allowed', 400), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = upload;

const multer = require('multer');
const AppError = require('../utils/app-error');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, callback) => {
    if (!file || !/^(image|video)\//.test(file.mimetype || '')) {
      callback(new AppError('Only image and video files are allowed', 400), false);
      return;
    }
    callback(null, true);
  },
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

module.exports = upload;

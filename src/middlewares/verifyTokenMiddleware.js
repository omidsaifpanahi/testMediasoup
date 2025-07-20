const axios  = require('axios');
const logger = require("../utilities/logger");

async function verifyTokenMiddleware(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    logger.error("توکن ارسال نشده است.")
    return next(new Error("توکن ارسال نشده است."));
  }

  try {
    const response = await axios.get(
      process.env.API_GETWAY+'/identity/api/v1/Token/Verify',
      {
        headers: {
          'accept': 'application/json',
          'Token-Header': token
        }
      }
    );    
    socket.userIsValid = response.data;
    next();

  } catch (error) {
    logger.error("[verifyTokenMiddleware] خطا در تأیید توکن:", error?.response?.data || error.message);
    return next(new Error("احراز هویت ناموفق. توکن نامعتبر است."));
  }
}

module.exports = verifyTokenMiddleware;
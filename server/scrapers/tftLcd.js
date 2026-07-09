'use strict';
const { getTrendforcePriceData } = require('./trendforcePrice');

function getTftLcdData() {
  return getTrendforcePriceData('tftLcd');
}

module.exports = { getTftLcdData };

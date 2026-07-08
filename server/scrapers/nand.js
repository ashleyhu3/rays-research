'use strict';
const { getTrendforcePriceData } = require('./trendforcePrice');

function getNandData() {
  return getTrendforcePriceData('nand');
}

module.exports = { getNandData };

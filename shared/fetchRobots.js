const fetch = require('node-fetch')

async function fetchRobots(site) {
  try {
    db.collection('robots').findOne({ site })
  } catch (e) {

  }

  try {
    const res = await fetch(site + '/robots.txt')
    if (res.ok) {

    } else if (res.status === 404) {

    }
    console.log(robots)
  } catch (e) {
    throw e
  }
}

module.exports = fetchRobots

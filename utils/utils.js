"use strict"

let Utils = {
    getEloScore: function getEloScore(rA, rB, sA, sB) {
        let k = 32
        let eA = 1 / (1 + Math.pow(10, (rB - rA) / 400))
        let eB = 1 / (1 + Math.pow(10, (rA - rB) / 400))

        let rrA = rA + k * (sA - eA)
        let rrB = rB + k * (sB - eB)

        return { ptA: rrA, ptB: rrB }
    },
    getExpScore: function getExpScore(expA, expB, scoreA, scoreB) {
        let rExpA = expA, rExpB = expB
        if (scoreA === scoreB) {
            rExpA += 0.5
            rExpB += 0.5
        } else if (scoreA > scoreB) {
            rExpA += 1
            if (expA > expB) rExpB += 0.5
        } else if (scoreA < scoreB) {
            rExpB += 1
            if (expA < expB) rExpA += 0.5
        }
        return { expA: rExpA, expB: rExpB }
    }
}

module.exports = Utils
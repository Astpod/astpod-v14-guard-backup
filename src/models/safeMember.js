const mongoose = require("mongoose")

const safe = mongoose.Schema({
    guildID: {type: String, required: true},
    Full: {type: Array, default: [], required: true},
    Owner: {type: Array, default: [], required: true},
    Role: {type: Array, default: [], required: true},
    Channel: {type: Array, default: [], required: true},
    BanAndKick: {type: Array, default: [], required: true},
})

module.exports = mongoose.model("safeschmea", safe);
const mongoose = require("mongoose")

const role = mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    color: { type: Number, required: true },
    position: { type: Number, required: true },
    permissions: { type: Array, default: [], required: true },
    channelOverwrites: { type: Array, default: [], required: true },
    members: { type: Array, default: [], required: true },
    hoist: { type: Boolean, default: false, required: true },
    mentionable: { type: Boolean, default: false, required: true }
})

module.exports = mongoose.model("roleschema", role);
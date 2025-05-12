const mongoose = require("mongoose")

const channels = mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    parent: { type: String, required: false, default: undefined },
    topic: { type: String, required: false },
    position: { type: Number, required: false },
    userLimit: { type: Number, required: false },
    nsfw: { type: Boolean, required: false  },
    permissionOverwrites: { type: Array, default: [], required: false }
})

module.exports = mongoose.model("channelschema", channels);
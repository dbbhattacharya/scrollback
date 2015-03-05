/* jshint browser:true, node:true */
/* global $ */

var core, config, store, initSent;
module.exports = function(c, conf, s) {

	core = c;
	config = conf;
	store = s;

	$(window).on("message", function(event) {
		var data = event.originalEvent.data;
		var action;
		if (event.originalEvent.origin !== "https://" + location.host) return;
		if (typeof data === 'string') {
			try {
				action = JSON.parse(data);
			} catch (e) {
				console.log("Error parsing incoming action: ", data, e);
				return;
			}
		} else {
			action = data;
		}

		if (!data.command || data.command != "signin") return;
		sendInit(action);
	});

	function sendInit(action) {
		if (initSent) return;
		delete action.command;
		initSent = true;
		if (initSent) {
			core.emit('init-up', action, function() {
				initSent = false;
			});
		} else {
			initSent = false;
		}
	}
};

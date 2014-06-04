/* jshint browser: true */
/* global $, libsb, lace, currentState */

var $itemTmpl = $(".meta-conf .list-item");
var currentConfig;

$(".configure-button").on("click", function() {
    libsb.emit('navigate', { mode: "conf", source: "configure-button", room: location.pathname.replace('/', '') });
});

$(".conf-save").on("click", function(){
    if(currentState.mode == 'conf'){
        libsb.emit('config-save', {id: window.currentState.room, description: '', identities: [], params: {}}, function(err, room){
            var roomObj = {to: currentState.room, room: room};
            libsb.emit('room-up', roomObj, function(){
                    currentConfig = null;
                    $('.conf-area').empty();
                    libsb.emit('navigate', { mode: "normal", tab: "info", source: "conf-save" });
            });
        });
    }
});

$(".conf-cancel").on("click", function() {
        currentConfig = null;
        // $('.settings-menu').empty();
        $('.conf-area').empty();
        libsb.emit('navigate', { mode: "normal", tab: "info", source: "conf-cancel" });
});


function getRooms(){
        var sortable = []; // for sorting the config options based on priority
        libsb.getRooms({ref: currentState.room}, function(err, data){
           var room = data.results[0];
           var roomObj = {room: room};
            libsb.emit('config-show', roomObj, function(err, tabs) {
                    delete tabs.room;
                    
                    currentConfig = tabs;

                    $('.meta-conf').empty();
                    $('.conf-area').empty();
                    for(i in tabs) {
                            sortable.push([tabs[i].prio, i, tabs[i]]);
                    }
                    sortable.sort(function(a,b){
                            return b[0] - a[0];
                    });
                    sortable.forEach(function(tab){
                            var className = 'list-item-' + tab[1] + '-settings';
                            $('.' + className).remove();
                            $('.meta-conf').append('<a class="list-item ' + className + '">' + tab[2].text + '</a>');
                            $('.conf-area').append(tab[2].html);
                    });
                    // making general settings the default tab
                    $('.list-item-general-settings').addClass('current');
                    $('.list-view-general-settings').addClass('current');

             });
        });
}

libsb.on('navigate', function(state, next) {
        // check state.mode == settings
        var isOwner = false;
        if(state.mode === "conf"){
                // if currentConfig is blank, then
                libsb.memberOf.forEach(function(room){
                      if(room.id == currentState.room && room.role == "owner") isOwner = true;
                });
                if(isOwner == false){
                      libsb.emit('navigate', {mode: 'normal'});
                }
                if(!currentConfig){
                    if(libsb.isInited){
                        getRooms();
                    }else{
                        libsb.on('inited', function(){
                            getRooms();
                        });
                    }
               }
        }
        next();
});
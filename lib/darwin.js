var rimraf = require('rimraf'),
    exec   = require('child_process').exec,
    execFile   = require('child_process').execFile,
    async  = require('async');

//  var exec   = require('sudoer').exec;

const username_regex = /^[a-z_][a-z0-9_-]{0,31}$/;

function assert_valid_username(user) {
  // Can catch injection attacks
  if (!username_regex.test(user)){
    throw new Error("Invalid user name");
  };
}
  
var dscl        = '/usr/bin/dscl',
    edit_group  = '/usr/sbin/dseditgroup',
    create_home = '/usr/sbin/createhomedir';

var debugging   = !!process.env.DEBUG,
    debug       = debugging ? console.log : function() { };

/*
var get_info = function(user, cb) {
  var key = '/Users/' + user,
      cmd = dscl + ' . read ' + key;

  var parse = function(str) {
    var obj = {};
    str.toString().split('\n').forEach(function(line, i) {

      if (line != '') {
        var split = line.split(': '),
            key = split[0].trim().toLowerCase().replace(/\s/g, '_'),
            val = (split[1] || '').replace(/'/g, '');

        obj[key] = val;
      }

    })
    return obj;
  }

  exec(cmd, function(err, out) {
    if (err) return cb(err);

    return cb(null, parse(out));
  })
}
*/

var get_new_user_id = function(cb) {
  var cmd = dscl + " . -list /Users UniqueID | awk '{print $2}' | sort -ug | tail -1";
  exec(cmd, function(err, out) {
    if (err) return cb(err);

    cb(null, parseInt(out.toString().trim()) + 1);
  })
}

exports.get_groups = function(user, cb) {
  assert_valid_username(user);

  var cmd = dscl + ' . -search /Groups GroupMembership "' + user + '"';
  // var cmd = 'groups ' + user;

  debug('Getting groups for ' + user);
  exec(cmd, function(err, out) {
    if (err) return cb(err);

    var list = out.toString().split('\n')
      .filter(function(line) {
        return line.match('GroupMembership')
      })
      .map(function(line) {
        return line.split('GroupMembership')[0].trim()
      })

    cb(null, list);
  })
}

exports.remove_from_group = function(user, group_name, cb) {
  assert_valid_username(user);

  var cmd = dscl + ' . -delete "/Groups/' + group_name + '" GroupMembership "' + user + '"';
  debug('Running ' + cmd);
  exec(cmd, cb);
}

exports.remove_from_groups = function(user, cb) {
  assert_valid_username(user);

  exports.get_groups(user, function(err, list) {
    if (err || list.length == 0) return cb(err);

    var fx = list.map(function(group_name) {
      return function(cb) { exports.remove_from_group(user, group_name, cb) }
    })

    async.parallel(fx, cb);
  })
}

exports.exists = function(user, cb) {
  execFile('id', [user], function(e, out, err) {
    var bool = out && !!out.toString().match('(' + user + ')') || false;
    cb(bool);
  })
}

exports.create = function(opts, cb) {

  var user      = opts.user,
      key       = '/Users/' + user,
      home      = typeof opts.home === 'undefined' ? key : opts.home,
      full_name = opts.name || opts.full_name,
      user_id   = opts.id || opts.user_id,
      group_id  = opts.group_id || user_id,
      shell     = opts.shell || '/bin/bash';

  if (!user || !full_name)
    throw new Error('User, ID and full name are required.');

  assert_valid_username(user);
  
  var go = function() {

    var cmds = [
      dscl + ' . create ' + key,
      dscl + ' . create ' + key + ' RealName "' + full_name + '"',
      dscl + ' . create ' + key + ' UserShell ' + shell
    ];

    if (opts.password && opts.password.trim() != '') {
      cmds.push(dscl + ' . passwd ' + key + ' ' + opts.password)
    }

    if (user_id) {
      cmds.push(dscl + ' . create ' + key + ' UniqueID ' + user_id);
    }

    if (group_id) {
      cmds.push(dscl + ' . create ' + key + ' PrimaryGroupID ' + group_id);
    }

    if (opts.groups) {
      opts.groups.forEach(function(group_name) {
        cmds.push(dscl + ' . append ' + key + ' GroupMembership ' + group_name);
      })
    }

    if (opts.hidden) {
      cmds.push(dscl + ' . delete ' + key + ' AuthenticationAuthority');
    } else if (opts.guest) {
      cmds.push(dscl + ' . create ' + key + ' "dsAttrTypeNative:_guest: true"');
    }

    if (home) {
      cmds.push(dscl + ' . create ' + key + ' NFSHomeDirectory ' + dir);

      if (!fs.existsSync(home))
        cmds.push(create_home + ' -u ' + user);
    } 

    var fx = cmds.map(function(str) {
      return function(cb) {
        debug('Running ' + str);
        exec(str, cb);
      }
    })

    async.series(fx, function(err, results) {
      cb(err, results);
    })
  }

  exports.exists(user, function(exists) {
    if (exists) return cb(new Error('User already exists.'));

    if (user_id) 
      return go();

    get_new_user_id(function(err, id) {
      if (err) return cb(err);

      user_id = id;
      if (!group_id) group_id = id;
      go();
    })
  });

}

exports.delete = function(user, opts, cb) {

  if (typeof opts == 'function') {
    cb = opts;
    opts = {};
  }

  var key  = '/Users/' + user;

  if (!user || user.trim() == '')
    throw new Error('Invalid user name');
  
  exports.exists(user, function(exists) {
    if (!exists) return cb(new Error('User does not exist'));

    var fx = [];

    // start by removing from all groups
    fx.push(function(cb) {
      exports.remove_from_groups(user, cb)
    })

    // then remove from main group and delete the user key
    var cmds = [
      edit_group + ' -o delete ' + user,
      dscl + ' . delete ' + key
    ];

    cmds.forEach(function(str) {
      fx.push(function(cb) {
        debug('Running ' + str);
        exec(str, cb);
      })
    })

    // finally, remove the home directory, if requested
    // TODO: we need to get his actual home path, not assume it's /Users/foo
    /*
    if (opts.delete_home || opts.remove_home) {
      fx.push(function(cb) { return rimraf(key, cb) })
    }
    */

    async.series(fx, function(err, results) {
      cb(err, results);
    })

  });
}

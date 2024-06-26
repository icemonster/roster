var fs    = require('fs'),
    which = require('which').sync,
    execFile  = require('child_process').execFile,
    rmdir = require('rimraf');

var useradd = which('useradd'),
    userdel = which('userdel');

var debug = !!process.env.DEBUG; 
var log   = debug ? console.log : function() { };

var codes = {
  '1': "Can't update password file. Are you root?",
  '2': "Invalid command syntax",
  '3': "Invalid argument to option",
  '4': "UID already in use (and no -o)",
  '6': "Specified group doesn't exist",
  '9': "Username already in use",
  '10': "Can't update group file",
  '12': "Can't create home directory",
  '13': "Can't create mail spool",
  '14': "Can't update SELinux user mapping"
}

var determine_error = function(err) {
  if (err.code && codes[err.code.toString()])
    return new Error(codes[err.code.toString()]);
  else
    return new Error(err.message || 'Failed');
}

var get_home_path = function(user, cb) {
  cb(new Error('TODO.'));
}

exports.exists = function(user, cb) {
  execFile('id', [user], function(e, out, err) {
    var bool = out && !!out.toString().match('(' + user + ')') || false;
    cb(bool);
  })
}

exports.create = function(opts, cb) {

  var user      = opts.user,
      home      = typeof opts.home === 'undefined' ? '/home/' + user : opts.home,
      full_name = opts.name || opts.full_name,
      user_id   = opts.id || opts.user_id,
      group_id  = opts.group_id,
      shell     = opts.shell || '/bin/bash';

  var args = [];

  args.push('-c') // comment field, but used as user's full name
  args.push(full_name)
  args.push('-s')
  args.push(shell)

  if (user_id) {
    args.push('-uid');
    args.push(user_id);
  }

  if (group_id) {
    args.push('-gid');
    args.push(group_id);
  } else {
    args.push('-U'); // create a group called as the user, and add him to it.
  }

  if (opts.groups) {
    var list = opts.groups.join(',');
    args.push('-G');
    args.push(list);
  }

  if (opts.system) {
    args.push('-r'); // system account
  }

  if (home) {
    args.push('-d');
    args.push(home);

    if (!fs.existsSync(home))
      args.push('-m'); // also create it, if missing
  } else {
    args.push('-M'); // do not create home. there is none!
  }
  args.push(user);
  log('Running useradd with args: ' + args.join(' '));
  execFile(useradd, args, function(err, out) {
    if (err) return cb(determine_error(err));

    cb(null, out);
  });
}

exports.delete = function(user, opts, cb) {

  if (typeof opts == 'function') {
    cb = opts;
    opts = {};
  }

  // TODO: get user's home path from /etc/passwd in order to remove it
  var delete_home = false; // opts.delete_home;

  var remove_him = function(cb) {
    log('Deleting user ' + user);
    execFile(userdel, [user], cb);
  }

  get_home_path(user, function(err, home_path) {

    remove_him(function(err) {
      if (err || !home_path) return cb(err);

      rmdir(home_path, cb);
    })
  })

}
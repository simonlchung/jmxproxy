var jmxproxyConf;
var endpointHost;
var alertTimeout;

var endpointHostClass = function(prefix, host) {
    var creds = null;

    var items = {
        'overview-mem-gr': [{
            'label': 'Heap Used',
            'data':  [],
        }],
        'overview-thr-gr': [{
            'label': 'Live Threads',
            'data':  [],
        }],
        'overview-cls-gr': [{
            'label': 'Loaded Classes',
            'data':  [],
        }],
        'overview-cpu-gr': [{
            'label': 'Process CPU',
            'data':  [],
        }],
        'threads-gr': [
            {
                'label': 'Live Running Threads',
                'data':  [],
            },
            {
                'label': 'Peak Running Threads',
                'data':  [],
            },
        ],
        'classes-gr': [
            {
                'label': 'Current Classes Loaded',
                'data':  [],
            },
            {
                'label': 'Total Classes Loaded',
                'data':  [],
            },
        ],
        'memory-gr': {
            'selected': 'hm',
            'hm': [{
                'label': 'Heap Memory Usage',
                'data':  [],
                'info':  {},
            }],
            'nm': [{
                'label': 'Non Heap Memory Usage',
                'data':  [],
                'info':  {},
            }],
        },
    };

    var graph = {
        'full': {
            'legend': {
                'show': true,
                'backgroundOpacity': 0.1,
            },
            'pan': {
                'interactive': true,
            },
            'zoom': {
                'interactive': true,
            },
        },
        'bare': {
            'legend': {
                'show': false,
            },
        },
    };

    var refreshMemory = function(item) {
        items['memory-gr'].selected = item;
        $('#memory-text').text(items['memory-gr'][item][0].label);
        $('#memory-hh').text(formatSize(items['memory-gr'][item][0].info.used));
        $('#memory-hc').text(formatSize(items['memory-gr'][item][0].info.committed));
        $('#memory-hm').text(formatSize(items['memory-gr'][item][0].info.max));

        refreshGraphs('memory-gr', true, formatSize);
    }

    var refreshGraphs = function(name, bare, type) {
        if (_.has(items, name) && $('#'+name).is(':visible')) {
            opts = {
                grid: {
                    hoverable: true,
                    clickable: false,
                },
                series: {
                    lines: {
                        show: true,
                    },
                    points: {
                        show: true,
                    },
                },
                xaxis: {
                    mode: 'time',
                    timezone: 'browser',
                    timeformat: '%H:%M',
                },
                yaxis: {
                    labelWidth: 64,
                    tickFormatter: _.isUndefined(type) ? Math.floor : type,
                },
            };

            if (name != 'memory-gr') {
                $.plot($('#'+name), items[name], $.extend(opts, graph[bare ? 'bare' : 'full']));
            } else {
                $.plot($('#'+name), items[name][items[name].selected], $.extend(opts, graph.full));
            }
        }
    };

    var buildBeanTree = function() {
        fetchData('/', function(data) {
            tree = [];
            data.sort();

            var dataSource = function(nodeData, callback) {
                callback({
                    data: _.has(nodeData, 'tree') ? nodeData.tree : tree,
                });
            };

            var addHeader = function(tree, name) {
                find = _.findIndex(tree, {text: name});
                item = {
                    text: name,
                    type: 'folder',
                    tree: [],
                };

                if (find == -1) {
                    tree.push(item);
                } else if (tree[find].type == 'item') {
                    tree.splice(find, 0, item);
                } else {
                    item = tree[find];
                }

                return item;
            };

            for (bean in data) {
                head = data[bean].split(':')[0].replace(/"/g, '');

                node = addHeader(tree, head);

                body = data[bean].split(':').pop().split(',');
                for (part in body) {
                    name = body[part].split('=').pop().replace(/"/g, '');
                    if (part == body.length - 1) {
                        size = name.length;
                        bits = name.split('.');
                        for (i = 0; i < bits.length - 1 && size > 25; i++) {
                            size -= (bits[i].length - 1);
                            bits[i] = bits[i][0];
                        }
                        name = bits.join('.');

                        item = {
                            text: name,
                            type: 'item',
                            attr: {
                                'title': data[bean],
                                'data-toggle': 'tooltip',
                                'data-placement': 'right',
                            },
                        };

                        node.tree.push(item);
                    } else {
                        node = addHeader(node.tree, name);
                    }
                }
            }

            $('#mbeans-tree')
            .tree({
                dataSource: dataSource,
                folderSelect: false,
            })
            .on('disclosedFolder.fu.tree', function(e, node) {
                $('.tree-item').tooltip({
                    container: 'body'
                });
            })
            .on('selected.fu.tree', function(e, node) {
                $('#attr-banner').addClass('hidden');
                $('#mbeans-data').removeClass('hidden');
                buildBeanData(node.target.attr.title);
            })
            .on('deselected.fu.tree', function(e, node) {
                $('#attr-banner').removeClass('hidden');
                $('#mbeans-data').addClass('hidden');
            });
        });
    };

    var buildBeanData = function(bean) {
        fetchData('/'+bean+'?full=true', function(data) {
            var columns = [{
                label: 'Name',
                property: 'key',
                sortable: true,
            }, {
                label: 'Value',
                property: 'val',
                sortable: true,

            }];

            var typeMap = {
                'array': function(k, v) {
                    return [1, k];
                },
                'object': function(k, v) {
                    return [2, k];
                },
                'boolean': function(k, v) {
                    return [3 + (v ^ 1), k];
                },
                'null': function(k, v) {
                    return [5, k];
                },
                'number': function(k, v) {
                    return [6, v];
                },
                'string': function(k, v) {
                    return [7, v];
                },
            };

            var objects = _.map(data, function(val, key) {
                return {
                    key: key,
                    val: val,
                    srt: typeMap[$.type(val)](key, val),
                };
            });

            var addStringValue = function(elem, text) {
                elem.html('23');

                h1 = elem.height();
                elem.text(text)
                h2 = elem.height();

                if (h1 < h2) {
                    t = text;
                    a = $('<a/>')
                    .attr('href', '#')
                    .data('content', text)
                    .addClass('text-primary')
                    .text(t)
                    .click(function() {
                        tmp = $(this).html();
                        $(this)
                            .html($(this).data('content'))
                            .data('content', tmp)
                            .next()
                                .toggleClass('hidden');
                    });

                    elem.html(
                        $('<div/>')
                        .append(a)
                        .append(
                            $('<span/>')
                            .addClass('badge progress-bar-danger pull-right')
                            .text(text.length)
                        )
                    );

                    while (h1 < h2) {
                        t = t.slice(0, -5);
                        a.html(t + '&nbsp;&raquo;');
                        h2 = elem.height();
                    }
                }
            };


            var mainDataSource = function(options, callback) {
                list = _.extend([], objects);

                if (options.search) {
                    list = _.filter(list, function(item) {
                        s = options.search.toLowerCase();

                        a = item.key.toLowerCase();
                        b = item.srt.join(',').toLowerCase();
                        c = (item.val + '').toLowerCase();
                        d = $.type(item.val).toLowerCase();

                        return (
                            a.indexOf(s) >= 0 ||
                            b.indexOf(s) >= 0 ||
                            c.indexOf(s) >= 0 ||
                            d.indexOf(s) >= 0
                        );
                    });
                }

                if (options.sortProperty) {
                    list.sort(function(a, b) {
                        if (options.sortProperty == 'key') {
                            return a.key.localeCompare(b.key);
                        } else if (a.srt[0] < b.srt[0]) {
                            return -1;
                        } else if (a.srt[0] > b.srt[0]) {
                            return 1;
                        } else if (a.srt[0] == typeMap.number()[0]) {
                            return a.srt[1] - b.srt[1];
                        } else {
                            return a.srt[1].localeCompare(b.srt[1]);
                        }
                    });

                    if (options.sortDirection === 'desc') {
                        list.reverse();
                    }
                }

                rval = {
                    columns: columns,
                    count:   list.length,
                    pages:   Math.ceil(list.length / options.pageSize),
                    page:    options.pageIndex,
                };

                rval.start = options.pageIndex * options.pageSize + 1;
                rval.end   = _.min([rval.start + options.pageSize - 1, rval.count]);
                rval.items = list.slice(rval.start - 1, rval.end);
                callback(rval);
            };

            var mainColBuilder = function(helpers, callback) {
                if (helpers.columnAttr == 'val') {
                    helpers.item.html('');
                    key = helpers.rowData.key;
                    val = helpers.rowData.val;

                    if (_.isArray(val) || _.isObject(val)) {
                        helpers.item
                        .html(
                            $('<button/>')
                            .attr('title', 'Expand')
                            .data('attrib-name', key)
                            .data('attrib-data', val)
                            .data('toggle', 'tooltip')
                            .data('placement', 'bottom')
                            .tooltip({
                                container: 'body',
                            })
                            .click(function() {
                                $('#attrib-modal')
                                .data('attrib-name', $(this).data('attrib-name'))
                                .data('attrib-data', $(this).data('attrib-data'))
                                .modal();
                            })
                            .addClass('btn btn-xs btn-info')
                            .text($.type(val))
                        )
                        .append(
                            $('<span/>')
                            .addClass('badge progress-bar-danger pull-right')
                            .text(_.size(val))
                        );
                    } else if (_.isNull(val)) {
                        helpers.item
                        .addClass('text-danger')
                        .text('null');
                    } else if (_.isNaN(val)) {
                        helpers.item
                        .addClass('text-danger')
                        .text('NaN');
                    } else if (_.isBoolean(val)) {
                        helpers.item
                        .addClass('text-warning')
                        .text(val);
                    } else if (_.isNumber(val)) {
                        helpers.item
                        .addClass('text-success')
                        .text(val);
                    } else if (_.isString(val)) {
                        addStringValue(helpers.item.addClass('text-primary'), val);
                    } else {
                        helpers.item
                        .addClass('text-muted')
                        .text('unknown type (' + $.type(val) + ')');
                    }
                }

                callback();
            };

            var attrColBuilder = function(helpers, callback) {
                helpers.item.html('');

                val = helpers.rowData[helpers.columnAttr];

                if (_.isNull(val)) {
                    helpers.item
                    .addClass('text-danger')
                    .text('null');
                } else if (_.isNaN(val)) {
                    helpers.item
                    .addClass('text-danger')
                    .text('NaN');
                } else if (_.isBoolean(val)) {
                    helpers.item
                    .addClass('text-warning')
                    .text(val);
                } else if (_.isNumber(val)) {
                    helpers.item
                    .addClass('text-success')
                    .text(val);
                } else if (_.isString(val)) {
                    addStringValue(helpers.item.addClass('text-primary'), val);
                } else {
                    helpers.item
                    .addClass('text-muted')
                    .text('unknown type (' + $.type(val) + ')');
                }

                callback();
            };

            var attrDataSource = function(options, callback) {
                list = [];
                cols = [];

                data = this.dataTarget;
                if (_.isArray(data)) {
                    if (data.length && _.isObject(data[0])) {
                        cols = _.map(data[0], function(v, k) {
                            return {
                                label: k.charAt(0).toUpperCase() + k.slice(1),
                                property: k,
                                sortable: true,
                            };
                        });
                        list = _.extend([], data);
                    } else if (data.length) {
                        cols = [{
                            label: 'Value',
                            property: 'val',
                            sortable: true,
                        }];
                        list = _.map(data, function(v) {
                            return {
                                val: v,
                            };
                        })
                    }
                } else if (_.isObject(data)) {
                    cols = [{
                        label: 'Name',
                        property: 'key',
                        sortable: true,
                    }, {
                        label: 'Value',
                        property: 'val',
                        sortable: true,
                    }];
                    list = _.map(data, function(v, k) {
                        return {
                            key: k,
                            val: v,
                        };
                    });
                }

                if (options.search) {
                    list = _.filter(list, function(item) {
                        s = options.search.toLowerCase();
                        for (key in item) {
                            a = key.toLowerCase();
                            b = (item[key] + '').toLowerCase();
                            c = $.type(item[key]).toLowerCase();

                            if (a.indexOf(s) >= 0 || b.indexOf(s) >= 0 || c.indexOf(s) >= 0) {
                                return true;
                            }
                        }

                        return false;
                    });
                }

                if (options.sortProperty) {
                    list = _.sortBy(list, options.sortProperty);
                    if (options.sortDirection === 'desc') {
                        list.reverse();
                    }
                }

                rval = {
                    columns: cols,
                    count:   list.length,
                    pages:   Math.ceil(list.length / options.pageSize),
                    page:    options.pageIndex,
                };

                rval.start = options.pageIndex * options.pageSize + 1;
                rval.end   = _.min([rval.start + options.pageSize - 1, rval.count]);
                rval.items = list.slice(rval.start - 1, rval.end);
                callback(rval);
            };

            if ($('#mbeans-data').data('fu.repeater')) {
                $('#mbeans-data')
                .repeater('clear')
                .removeData('fu.repeater');
            }
            $('#mbeans-data').repeater({
                dataSource: mainDataSource,
                list_columnRendered: mainColBuilder,
            });
            $('#mbean-title')
            .text(bean.length > 75 ? bean.substring(0, 72) + '...' : bean)
            .attr('title', bean)
            .data('toggle', 'tooltip')
            .data('placement', 'bottom')
            .tooltip();
            $('#mbean-reset')
            .data('target', bean)
            .click(function() {
                buildBeanData($(this).data('target'));
            });

            $('#attrib-modal')
            .on('hidden.bs.modal', function() {
                $('#attrib-data')
                .repeater('clear')
                .removeData('fu.repeater');
            })
            .on('shown.bs.modal', function() {
                $('#attrib-name').text($(this).data('attrib-name'));
                $('#attrib-data').repeater({
                    dataSource: attrDataSource,
                    dataTarget: $(this).data('attrib-data'),
                    list_columnRendered: attrColBuilder,
                });
            });
        });
    };

    var gatherObjects = function(limit) {
        ts = new Date().getTime();

        loadHistory = function(item, data, prop) {
            mapped = _.map(data, function(v, k) {
                return [ts - k * jmxproxyConf.cache_duration, _.has(v, prop) ? v[prop] : v];
            }).reverse();
            return _.isUndefined(item) ? mapped : item.concat(mapped);
        }

        fetchData('/', function(data) {
            $('#summary-gc, #memory-gc, #memory-bar-hm, #memory-bar-nm').empty();
            for (item in data) {
                if (data[item].lastIndexOf('java.lang:type=GarbageCollector', 0) === 0) {
                    fetchData('/'+data[item]+'?full=true', function(item) {
                        $('#summary-gc').append('Name = "'+item.Name+'"; Collections = '+item.CollectionCount+'; Time spent = '+formatTime(item.CollectionTime, 2)+'<br>');
                        $('#memory-gc').append(formatTime(item.CollectionTime, 2)+' on '+item.Name+' ('+item.CollectionCount+' collections)<br>');
                    });
                } else if (data[item].lastIndexOf('java.lang:type=MemoryPool') === 0) {
                    fetchData('/'+data[item]+'?full=true&limit='+limit, function(full) {
                        item = _.mapObject(full, function(v, k) { return v[0]; });
                        if (item.Usage.max <= 0) {
                            return;
                        }
                        if (_.has(items['memory-gr'], item.Name)) {
                            items['memory-gr'][item.Name][0].data.push([ts, item.Usage.used]);
                            items['memory-gr'][item.Name][0].info = {
                                used:      item.Usage.used,
                                committed: item.Usage.committed,
                                max:       item.Usage.max,
                            };
                        } else {
                            items['memory-gr'][item.Name] = [{
                                label: item.Name+' Memory Usage',
                                data: loadHistory(undefined, full.Usage, 'used'),
                                info: {
                                    used:      item.Usage.used,
                                    committed: item.Usage.committed,
                                    max:       item.Usage.max,
                                },
                            }];
                        }
                        if (item.Type == 'HEAP') {
                            $('#memory-bar-hm')
                            .append(
                                $('<div/>')
                                .addClass('progress')
                                .attr('title', 'Memory Pool "'+item.Name+'"')
                                .data('toggle', 'tooltip')
                                .data('placement', 'left')
                                .data('target', item.Name)
                                .tooltip()
                                .click(function() {
                                    refreshMemory($(this).data('target'));
                                })
                                .append(
                                    $('<div/>')
                                    .addClass('progress-bar progress-bar-success')
                                    .width(formatPercent(100 * item.Usage.used / item.Usage.max))
                                    .text(formatPercent(100 * item.Usage.used / item.Usage.max))
                                )
                            );
                        } else if (item.Type == 'NON_HEAP') {
                            $('#memory-bar-nm')
                            .append(
                                $('<div/>')
                                .addClass('progress')
                                .attr('title', 'Memory Pool "'+item.Name+'"')
                                .data('toggle', 'tooltip')
                                .data('placement', 'left')
                                .data('target', item.Name)
                                .tooltip()
                                .click(function() {
                                    refreshMemory($(this).data('target'));
                                })
                                .append(
                                    $('<div/>')
                                    .addClass('progress-bar progress-bar-info')
                                    .width(formatPercent(100 * item.Usage.used / item.Usage.max))
                                    .text(formatPercent(100 * item.Usage.used / item.Usage.max))
                                )
                            );
                        }
                        refreshGraphs('memory-gr', true, formatSize);
                    });
                }
            }
        });

        fetchData('/java.lang:type=ClassLoading?full=true&limit='+limit, function(full) {
            data = _.mapObject(full, function(v, k) { return v[0]; });
            $('#summary-cl').text(data.LoadedClassCount);
            $('#summary-cu').text(data.UnloadedClassCount);
            $('#summary-ct').text(data.TotalLoadedClassCount);
            $('#overview-cls-cl').text(data.LoadedClassCount);
            $('#overview-cls-cu').text(data.UnloadedClassCount);
            $('#overview-cls-ct').text(data.TotalLoadedClassCount);

            items['classes-gr'][0].data = loadHistory(items['classes-gr'][0].data, full.LoadedClassCount);
            items['classes-gr'][1].data = loadHistory(items['classes-gr'][1].data, full.TotalLoadedClassCount);
            refreshGraphs('classes-gr');

            items['overview-cls-gr'][0].data = loadHistory(items['overview-cls-gr'][0].data, full.LoadedClassCount);
            refreshGraphs('overview-cls-gr', true);
        });
        fetchData('/java.lang:type=Compilation?full=true', function(data) {
            $('#summary-jc').text(data.Name);
            $('#summary-jt').text(formatTime(data.TotalCompilationTime, 2));
        });
        fetchData('/java.lang:type=Memory?full=true&limit='+limit, function(full) {
            data = _.mapObject(full, function(v, k) { return v[0]; });
            $('#overview-mem-hh').text(formatSize(data.HeapMemoryUsage.used));
            $('#overview-mem-hc').text(formatSize(data.HeapMemoryUsage.committed));
            $('#overview-mem-hm').text(formatSize(data.HeapMemoryUsage.max));

            $('#memory-hh').text(formatSize(data.HeapMemoryUsage.used));
            $('#memory-hc').text(formatSize(data.HeapMemoryUsage.committed));
            $('#memory-hm').text(formatSize(data.HeapMemoryUsage.max));

            $('#summary-hh').text(formatSize(data.HeapMemoryUsage.used));
            $('#summary-hc').text(formatSize(data.HeapMemoryUsage.committed));
            $('#summary-hm').text(formatSize(data.HeapMemoryUsage.max));
            $('#summary-hf').text(data.ObjectPendingFinalizationCount+' object(s)');

            items['overview-mem-gr'][0].data = loadHistory(items['overview-mem-gr'][0].data, full.HeapMemoryUsage, 'used');
            refreshGraphs('overview-mem-gr', true, formatSize);

            items['memory-gr']['hm'][0].data = loadHistory(items['memory-gr']['hm'][0].data, full.HeapMemoryUsage, 'used');
            items['memory-gr']['nm'][0].data = loadHistory(items['memory-gr']['nm'][0].data, full.NonHeapMemoryUsage, 'used');
            items['memory-gr']['hm'][0].info = {
                used:      data.HeapMemoryUsage.used,
                committed: data.HeapMemoryUsage.committed,
                max:       data.HeapMemoryUsage.max,
            };
            items['memory-gr']['nm'][0].info = {
                used:      data.NonHeapMemoryUsage.used,
                committed: data.NonHeapMemoryUsage.committed,
                max:       data.NonHeapMemoryUsage.max,
            };
            refreshGraphs('memory-gr', true, formatSize);
        });
        fetchData('/java.lang:type=OperatingSystem?full=true&limit='+limit, function(full) {
            data = _.mapObject(full, function(v, k) { return v[0]; });
            $('#summary-pt').text(formatTime(data.ProcessCpuTime / 1000000, 3));
            $('#summary-mr').text(formatSize(data.TotalPhysicalMemorySize));
            $('#summary-ml').text(formatSize(data.FreePhysicalMemorySize));
            $('#summary-ms').text(formatSize(data.TotalSwapSpaceSize));
            $('#summary-mp').text(formatSize(data.FreeSwapSpaceSize));
            $('#summary-sn').text(data.Name+'/'+data.Version);
            $('#summary-sa').text(data.Arch);
            $('#summary-sp').text(data.AvailableProcessors);
            $('#summary-sm').text(formatSize(data.CommittedVirtualMemorySize));

            $('#overview-cpu-up').text(formatPercent(data.ProcessCpuLoad));
            $('#overview-cpu-us').text(formatPercent(data.SystemCpuLoad));

            items['overview-cpu-gr'][0].data = loadHistory(items['overview-cpu-gr'][0].data, full.ProcessCpuLoad);
            refreshGraphs('overview-cpu-gr', true, formatPercent);
        });
        fetchData('/java.lang:type=Runtime?full=true', function(data) {
            $('#summary-ut').text(formatTime(data.Uptime));
            $('#summary-vm').text(data.VmName);
            $('#summary-vv').text(data.VmVendor);
            $('#summary-vn').text(data.Name);
        });
        fetchData('/java.lang:type=Threading?full=true&limit='+limit, function(full) {
            data = _.mapObject(full, function(v, k) { return v[0]; });
            $('#summary-tc').text(data.ThreadCount);
            $('#summary-tp').text(data.PeakThreadCount);
            $('#summary-td').text(data.DaemonThreadCount);
            $('#summary-tt').text(data.TotalStartedThreadCount);
            $('#overview-thr-tc').text(data.ThreadCount);
            $('#overview-thr-tp').text(data.PeakThreadCount);
            $('#overview-thr-tt').text(data.TotalStartedThreadCount);

            items['threads-gr'][0].data = loadHistory(items['threads-gr'][0].data, full.ThreadCount);
            items['threads-gr'][1].data = loadHistory(items['threads-gr'][1].data, full.PeakThreadCount);
            refreshGraphs('threads-gr');

            items['overview-thr-gr'][0].data = loadHistory(items['overview-thr-gr'][0].data, full.ThreadCount);
            refreshGraphs('overview-thr-gr', true);
        });

        setTimeout(function() { gatherObjects(1); }, jmxproxyConf.cache_duration);
    };

    var fetchName = function() {
        return creds == null ? host : creds.username+'@'+host;
    };

    var resetAuth = function(username, password) {
        creds = {
            username: username,
            password: password,
        }
        checkHost();
    };

    var fetchData = function(item, callback) {
        if (creds != null) {
            $.post(prefix+'/jmxproxy/'+host+item, creds, callback)
            .fail(function(jqXHR) {
                if (jqXHR.status == 401) {
                    $('#endpoint-auth').modal();
                    $('#endpoint-user').focus();
                } else if (jqXHR.status == 404) {
                    displayError('Selected endpoint is unavailable.');
                }
            });
        } else {
            $.getJSON(prefix+'/jmxproxy/'+host+item, callback)
            .fail(function(jqXHR) {
                if (jqXHR.status == 401) {
                    $('#endpoint-auth').modal();
                    $('#endpoint-user').focus();
                } else if (jqXHR.status == 404) {
                    displayError('Selected endpoint is unavailable.');
                }
            });
        }
    };

    var checkHost = function() {
        $('#welcome-banner, #endpoint-select').addClass('hidden');
        $('#endpoint-navbar, #endpoint-loader').removeClass('hidden');

        fetchData('/java.lang:type=Runtime/Uptime', function(test) {
            $('#endpoint-loader').addClass('hidden');
            $(document).attr('title', 'JMXProxy - ' + fetchName());
            $('#summary-cn, #navbar-label').text(fetchName());
            $('a[data-toggle="tab"]:first').tab('show');

            setTimeout(function() { gatherObjects(0) }, 0);
        });
    };

    checkHost();

    return {
        resetAuth: resetAuth,
        refreshMemory: refreshMemory,
        refreshGraphs: refreshGraphs,
        buildBeanTree: buildBeanTree,
    };
};

$(document).ready(function() {
    prefix = window.location.pathname.replace(/\/(?:index\.html)?$/, '');

    $(window)
    .resize(function() {
        loader = $('#endpoint-loader');
        loader.css({
            'margin-top': '-' + Math.round(loader.height() / 2) + 'px',
            'margin-left': '-' + Math.round(loader.width() / 2) + 'px',
        });
    })
    .trigger('resize')
    .keyup(function(e) {
        if (e.which == 37) { // left
            if ($('#endpoint-tabs li.active').is(':first-child')) {
                $('#endpoint-tabs a:last').tab('show');
            } else {
                $('#endpoint-tabs li.active').prev().find('a').tab('show');
            }
        } else if (e.which == 39) { // right
            if ($('#endpoint-tabs li.active').is(':last-child')) {
                $('#endpoint-tabs a:first').tab('show');
            } else {
                $('#endpoint-tabs li.active').next().find('a').tab('show');
            }
        } else if (e.which == 27) { // escape
            $('#attrib-modal').modal('hide');
        }
    });

    $('#endpoint-combo')
    .on('changed.fu.combobox', function(e, data) {
        if ($(this).data('trashing')) {
            $('input', this)
            .val('')
            .focus();

            elem = $(this).find('li[data-value="'+data.text+'"]');
            if (_.contains(jmxproxyConf.allowed_endpoints, data.text)) {
                elem.find('span').remove();
            } else {
                elem.remove();
            }

            if ($('#endpoint-combo ul li').length == 0) {
                $('#endpoint-combo button').prop('disabled', true);
            }
        } else if (!$(this).data('changing')) {
            console.log($(this).data('changing'));
            endpointHost = endpointHostClass(prefix, data.text);
            $('#endpoint-combo').data('changing', false);
        }
    })
    .data('trashing', false)
    .data('changing', false);

    $('#endpoint-combo input')
    .keypress(function(e) {
        if (e.keyCode == 13 && this.validity.valid) {
            endpointHost = endpointHostClass(prefix, $(this).val());
        }
    })
    .keyup(function(e) {
        $(this).parent()
        .toggleClass('has-error', !this.validity.valid)
        .toggleClass('has-success', this.validity.valid);

        $('#endpoint-combo').data('changing', $(this).val() != '');
    })
    .blur(function(e) {
        console.log('hi');
        $('#endpoint-combo').data('changing', false);
    });

    $('#endpoint-creds').submit(function() {
        endpointHost.resetAuth($('#endpoint-user').val(), $('#endpoint-pass').val());

        $('#endpoint-auth').modal('hide');
        return false;
    });

    $('#endpoint-alert > button.close').click(function () {
        $(this).parent().removeClass('in');
    });

    $('#memory-btn-hm').click(function() {
        endpointHost.refreshMemory('hm');
    });
    $('#memory-btn-nm').click(function() {
        endpointHost.refreshMemory('nm');
    });
    $('#memory-gr').mouseout(function() {
        endpointHost.refreshGraphs($(this).attr('id'), true, formatSize);
    });
    $('#threads-gr, #classes-gr').mouseout(function() {
        endpointHost.refreshGraphs($(this).attr('id'));
    });
    $('a[data-toggle="tab"]').on('shown.bs.tab', function(e) {
        text = e.target.text.toLowerCase().trim();
        if (text == 'overview') {
            endpointHost.refreshGraphs('overview-mem-gr', true, formatSize);
            endpointHost.refreshGraphs('overview-thr-gr', true);
            endpointHost.refreshGraphs('overview-cls-gr', true);
            endpointHost.refreshGraphs('overview-cpu-gr', true, formatPercent);
        } else if (text == 'memory') {
            endpointHost.refreshMemory('hm');
        } else if (text == 'classes' || text == 'threads') {
            endpointHost.refreshGraphs(text + '-gr');
        } else if (text == 'mbeans') {
            endpointHost.buildBeanTree();
        }
    });

    $('#overview-mem-gr').parent().parent().click(function() {
        $('#endpoint-tabs a[href="#memory"]').tab('show');
    });
    $('#overview-thr-gr').parent().parent().click(function() {
        $('#endpoint-tabs a[href="#threads"]').tab('show');
    });
    $('#overview-cls-gr').parent().parent().click(function() {
        $('#endpoint-tabs a[href="#classes"]').tab('show');
    });

    $('form').submit(function(e) {
        return false;
    });

    $('[data-toggle="tooltip"]').tooltip();

    $('.focused-graph').on('plothover', showGraphTooltip);
    $('.overview-graph').on('plothover', showGraphTooltip);

    $.getJSON(prefix+'/jmxproxy/config', function(data) {
        jmxproxyConf = data;
        bannerAction = $('#welcome-banner h3').text();

        $.getJSON(prefix+'/jmxproxy', function(data) {
            _.each(_.union(jmxproxyConf.allowed_endpoints, data), function(item) {
                if (_.contains(data, item)) {
                    trash = $('<span/>')
                    .data('value', item)
                    .addClass('glyphicon glyphicon-trash text-muted pull-right')
                    .mouseover(function() {
                        $('#endpoint-combo').data('trashing', true);
                        $(this).toggleClass('text-muted text-danger');
                    })
                    .mouseout(function() {
                        $('#endpoint-combo').data('trashing', false);
                        $(this).toggleClass('text-muted text-danger');
                    })
                    .click(function() {
                        $.ajax(prefix+'/jmxproxy/'+$(this).data('value'), {
                            method: 'DELETE',
                            success: function() {
                                $('#endpoint-combo')
                                .data('trashing', false);
                            },
                        })
                    });
                } else {
                    trash = '';
                }

                $('#endpoint-combo ul')
                .append(
                    $('<li/>')
                    .attr('data-value', item)
                    .append(
                        $('<a/>')
                        .attr('href', '#')
                        .append(item)
                        .append(trash)
                    )
                );
            });

            if ($('#endpoint-combo ul li').length > 0) {
                $('#endpoint-combo').combobox('enable');
            } else {
                $('#endpoint-combo button').prop('disabled', true);
            }

            if (jmxproxyConf.allowed_endpoints.length > 0) {
                $('#endpoint-combo input').prop('disabled', true);
                $('#welcome-banner h3').text(bannerAction.replace('{action}', 'select'));
            } else {
                $('#endpoint-combo input').focus();
                if (data.length > 0) {
                    $('#welcome-banner h3').text(bannerAction.replace('{action}', 'select or enter'));
                } else {
                    $('#welcome-banner h3').text(bannerAction.replace('{action}', 'enter'));
                }
            }
        })
        .fail(function() {
            displayError('Malformed cached endpoint list received from server.');
        });

    })
    .fail(function() {
        displayError('Malformed configuration data received from the server.');
    });
});

function formatTime(s, n) {
    v = s % 86400000;
    d = (s - v) / 86400000;
    s = v;

    v = s % 3600000;
    h = (s - v) / 3600000;
    s = v;

    v = s % 60000;
    m = (s - v) / 60000;
    s = (v / 1000).toFixed(_.isUndefined(n) ? 0 : n);

    parts = [];
    if (d) {
        parts.push(d + ' day' + (d == 1 ? '' : 's'));
    }
    if (h) {
        parts.push(h + ' hour' + (h == 1 ? '' : 's'));
    }
    if (m) {
        parts.push(m + ' minute' + (m == 1 ? '' : 's'));
    }
    if (s) {
        parts.push(s + ' second' + (s == 1 ? '' : 's'));
    }

    return parts.join(' ');
}

function formatSize(s) {
    if (s > (Math.pow(1024, 5))) {
        return (s / Math.pow(1024, 5)).toFixed(2) + 'PB';
    }
    if (s > (Math.pow(1024, 4))) {
        return (s / Math.pow(1024, 4)).toFixed(2) + 'TB';
    }
    if (s > (Math.pow(1024, 3))) {
        return (s / Math.pow(1024, 3)).toFixed(2) + 'GB';
    }
    if (s > (Math.pow(1024, 2))) {
        return (s / Math.pow(1024, 2)).toFixed(2) + 'MB';
    }
    if (s > (Math.pow(1024, 1))) {
        return (s / Math.pow(1024, 1)).toFixed(2) + 'KB';
    }

    return s + 'B';
}

function formatPercent(s) {
    return s.toFixed(2) + '%';
}

function displayError(text) {
    if (text != null) {
        $('#endpoint-error').text(text);
        $('#endpoint-alert').addClass('in');

        clearTimeout(alertTimeout);
        alertTimeout = setTimeout(function() {
            $('#endpoint-alert').removeClass('in');
        }, 5000);
    }
}

function showGraphTooltip(e, p, i) {
    var $tip = $('.graph-tooltip');

    if (i) {
        if (i.pageX != $tip.data('pageX') || i.pageY != $tip.data('pageY') || !$tip.data('shown') || !$tip.data('bs.tooltip')) {
            $tip
            .css({
                'top':  i.pageY,
                'left': i.pageX,
            })
            .tooltip({
                title: _.isFunction(i.series.yaxis.tickFormatter) ? i.series.yaxis.tickFormatter(i.datapoint[1]) : i.datapoint[1],
                placement: 'top',
            })
            .tooltip('fixTitle')
            .tooltip('show')
            .data('pageX', i.pageX)
            .data('pageY', i.pageY)
            .data('shown', true);
        }
    } else {
        $tip
        .tooltip('destroy')
        .data('shown', false)
    }
}

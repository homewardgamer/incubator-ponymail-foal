let admin_current_email = null;
let audit_entries = []
let audit_page = 0;
let audit_size = 30;

async function POST(url, formdata, state) {
    const resp = await fetch(url, {
        credentials: "same-origin",
        mode: "same-origin",
        method: "post",
        headers: {
            "Content-Type": "application/json"
        },
        body: formdata
    });
    return resp
}

// Deletes (hides) an email from the archives
async function admin_hide_email() {
    if (!confirm("Are you sure you wish to remove this email from the archives?")) {
        return
    }
    formdata = JSON.stringify({
        action: "delete",
        document: admin_current_email
    });
    let rv = await POST('%sapi/mgmt.json'.format(apiURL), formdata, {});
    let response = await rv.text();
    if (rv.status == 200) {
        modal("Email removed", "Server responded with: " + response, "help");
    } else {
        modal("Something went wrong!", "Server responded with: " + response, "error");
    }
}

// Saves an email with edits
async function admin_save_email() {
    let from = document.getElementById('email_from').value;
    let subject = document.getElementById('email_subject').value;
    let listname = document.getElementById('email_listname').value;
    let private = document.getElementById('email_private').value;
    let body = document.getElementById('email_body').value;
    let formdata = JSON.stringify({
        action: "edit",
        document: admin_current_email,
        from: from,
        subject: subject,
        list: listname,
        private: private,
        body: body
    })
    let rv = await POST('%sapi/mgmt.json'.format(apiURL), formdata, {});
    let response = await rv.text();
    if (rv.status == 200) {
        modal("Email changed", "Server responded with: " + response, "help");
    } else {
        modal("Something went wrong!", "Server responded with: " + response, "error");
    }
}

function admin_email_preview(stats, json) {
    admin_current_email = json.mid;
    let cp = document.getElementById("panel");
    let div = new HTML('div', {
        style: {
            margin: '5px'
        }
    });
    cp.inject(div);

    div.inject(new HTML('h1', {}, "Editing email " + json.mid + ":"));

    // Author
    let author_field = new HTML('div', {
        class: 'email_kv_edit'
    });
    let author_key = new HTML('div', {
        class: 'email_key'
    }, "From: ");
    let author_value = new HTML('input', {
        id: 'email_from',
        style: {
            width: "480px"
        },
        value: json.from
    });
    author_field.inject([author_key, author_value]);
    div.inject(author_field);

    // Subject
    let subject_field = new HTML('div', {
        class: 'email_kv_edit'
    });
    let subject_key = new HTML('div', {
        class: 'email_key'
    }, "Subject: ");
    let subject_value = new HTML('input', {
        id: 'email_subject',
        style: {
            width: "480px"
        },
        value: json.subject
    });
    subject_field.inject([subject_key, subject_value]);
    div.inject(subject_field);

    // Date
    let date_field = new HTML('div', {
        class: 'email_kv_edit'
    });
    let date_key = new HTML('div', {
        class: 'email_key'
    }, "Date: ");
    let date_value = new HTML('div', {
        class: 'email_value'
    }, new Date(json.epoch * 1000.0).ISOBare());
    date_field.inject([date_key, date_value]);
    div.inject(date_field);

    // List
    let listname = json.list_raw.replace(".", "@", 1).replace(/[<>]/g, "");
    let list_field = new HTML('div', {
        class: 'email_kv_edit'
    });
    let list_key = new HTML('div', {
        class: 'email_key'
    }, "List: ");
    let list_value = new HTML('input', {
        id: 'email_listname',
        style: {
            width: "480px"
        },
        value: listname
    });
    list_field.inject([list_key, list_value]);
    div.inject(list_field);

    // Private email?
    let priv_field = new HTML('div', {
        class: 'email_kv_edit'
    });
    let priv_key = new HTML('div', {
        class: 'email_key'
    }, "Visibility: ");
    let priv_value = new HTML('select', {
        id: 'email_private'
    });
    priv_value.inject(new HTML('option', {
        value: 'no',
        style: {
            color: 'green'
        },
        selected: json.private ? null : "selected"
    }, "Public"));
    priv_value.inject(new HTML('option', {
        value: 'yes',
        style: {
            color: 'red'
        },
        selected: json.private ? "selected" : null
    }, "Private"));
    priv_field.inject([priv_key, priv_value]);
    div.inject(priv_field);

    // Attachments?
    if (json.attachments && json.attachments.length > 0) {
        let attach_field = new HTML('div', {
            class: 'email_kv'
        });
        let attach_key = new HTML('div', {
            class: 'email_key'
        }, "Attachment(s): ");
        let alinks = [];
        for (let n = 0; n < json.attachments.length; n++) {
            let attachment = json.attachments[n];
            let link = `${pm_config.apiURL}api/email.lua?attachment=true&id=${json.mid}&file=${attachment.hash}`;
            let a = new HTML('a', {
                href: link,
                target: '_blank'
            }, attachment.filename);
            alinks.push(a);
            let fs = ` ${attachment.size} bytes`;
            if (attachment.size >= 1024) fs = ` ${Math.floor(attachment.size/1024)} KB`;
            if (attachment.size >= 1024 * 1024) fs = ` ${Math.floor(attachment.size/(1024*10.24))/100} MB`;
            alinks.push(fs);
            alinks.push(new HTML('br'));
        }
        let attach_value = new HTML('div', {
            class: 'email_value'
        }, alinks);
        attach_field.inject([attach_key, attach_value]);
        div.inject(attach_field);
    }

    let text = new HTML('textarea', {
        id: 'email_body',
        style: {
            width: "100%",
            height: "480px"
        }
    }, json.body);
    div.inject(text);

    let btn_edit = new HTML('button', {
        onclick: "admin_save_email();"
    }, "Save changes to archive");
    let btn_hide = new HTML('button', {
        onclick: "admin_hide_email();",
        style: {
            marginLeft: "36px",
            color: 'red'
        }
    }, "Remove email from archives");
    div.inject(new HTML('br'));
    div.inject(btn_edit);
    div.inject(btn_hide);
    div.inject(new HTML('br'));
    div.inject(new HTML('small', {}, "Modifying emails will remove the option to view their sources via the web interface, as the source may contain traces that reveal the edit."))
    div.inject(new HTML('br'));
    div.inject(new HTML('small', {}, "Emails that are removed may still be recovered by the base system administrator. For complete expungement, please contact the system administrator."))
}

function admin_audit_view(state, json) {
    let headers = ['Date', 'Author', 'Remote', 'Action', 'Target', 'Log'];
    let cp = document.getElementById("panel");
    let div = document.getElementById('auditlog_entries');
    if (!div) {
        div = new HTML('div', {
            id: "auditlog",
            style: {
                margin: '5px'
            }
        });
        cp.inject(div);
        div.inject(new HTML('h1', {}, "Audit log:"));
    }
    let table = document.getElementById('auditlog_entries');
    if (json.entries && json.entries.length > 0 || table) {
        if (!table) {
            table = new HTML('table', {
                border: "1",
                id: "auditlog_entries",
                class: "auditlog_entries"
            });
            let trh = new HTML('tr');
            for (let i = 0; i < headers.length; i++) {
                let th = new HTML('th', {}, headers[i] + ":");
                trh.inject(th);
            }
            table.inject(trh)
            div.inject(table);
            let btn = new HTML('button', {
                onclick: "admin_audit_next();"
            }, "Load more entries");
            div.inject(btn);
        }
        for (let i = 0; i < json.entries.length; i++) {
            let entry = json.entries[i];
            let tr = new HTML('tr', {
                class: "auditlog_entry"
            });
            for (let i = 0; i < headers.length; i++) {
                let key = headers[i].toLowerCase();
                let value = entry[key];
                if (key == 'target') {
                    value = new HTML('a', {
                        href: "/admin/" + value
                    }, value);
                }
                if (key == 'action') {
                    let action_colors = {
                        edit: 'blue',
                        delete: 'red',
                        default: 'black'
                    };
                    value = new HTML('spam', {
                        style: {
                            color: action_colors[value] ? action_colors[value] : action_colors['default']
                        }
                    }, value);
                }
                let th = new HTML('td', {}, value);
                tr.inject(th);
            }
            table.inject(tr);
        }
    } else {
        div.inject("Audit log is empty");
    }
}

function admin_audit_next() {
    audit_page++;
    GET('%sapi/mgmt.json?action=log&page=%u&size=%u'.format(apiURL, audit_page, audit_size), admin_audit_view, null);
}

// Onload function for admin.html
function admin_init() {
    let mid = location.href.split('/').pop();
    // Specific email/list handling?
    if (mid.length > 0) {
        // List handling?
        if (mid.match(/^<.+>$/)) {

        }
        // Email handling?
        else {
            GET('%sapi/email.json?id=%s'.format(apiURL, mid), admin_email_preview, null);
        }
    } else { // View audit log
        GET('%sapi/mgmt.json?action=log&page=%s&size=%u'.format(apiURL, audit_page, audit_size), admin_audit_view, null);
    }
}
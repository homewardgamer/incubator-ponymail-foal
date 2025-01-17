let full_emails = {};

async function render_email(state, json) {
    let div = state.div;
    full_emails[json.mid] = json; // Save for composer if replying later...
    if (state.scroll) {
        let rect = div.getBoundingClientRect();
        try {
            window.setTimeout(function() {
                window.scrollTo(0, rect.top - 48);
            }, 200);
            console.log("Scrolled to %u".format(rect.top - 48));
        } catch (e) {}
    }
    if (chatty_layout) {
        return render_email_chatty(state, json);
    }

    // Author
    let author_field = new HTML('div', {
        class: 'email_kv'
    });
    let author_key = new HTML('div', {
        class: 'email_key'
    }, "From: ");
    let author_value = new HTML('div', {
        class: 'email_value'
    }, json.from);
    author_field.inject([author_key, author_value]);
    div.inject(author_field);

    // Subject
    let subject_field = new HTML('div', {
        class: 'email_kv'
    });
    let subject_key = new HTML('div', {
        class: 'email_key'
    }, "Subject: ");
    let subject_value = new HTML('div', {
        class: 'email_value'
    }, json.subject == '' ? '(No subject)' : json.subject);
    subject_field.inject([subject_key, subject_value]);
    div.inject(subject_field);

    // Date
    let date_field = new HTML('div', {
        class: 'email_kv'
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
        class: 'email_kv'
    });
    let list_key = new HTML('div', {
        class: 'email_key'
    }, "List: ");
    let list_value = new HTML('div', {
            class: 'email_value'
        },
        new HTML('a', {
            href: 'list?%s'.format(listname)
        }, listname)
    );
    list_field.inject([list_key, list_value]);
    div.inject(list_field);

    // Private email??
    if (json.private === true) {
        let priv_field = new HTML('div', {
            class: 'email_kv'
        });
        let priv_key = new HTML('div', {
            class: 'email_key'
        }, "Private: ");
        let priv_value = new HTML('div', {
            class: 'email_value_emphasis'
        }, "YES");
        priv_field.inject([priv_key, priv_value]);
        div.inject(priv_field);
    }

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

    let text = new HTML('pre', {}, fixup_quotes(json.body));
    div.inject(text);

    // Private text?
    if (json.private === true) {
        text.style.backgroundImage = "url(images/private.png)";
    }


    let toolbar = new HTML('div', {
        class: 'toolbar'
    });

    // reply to email button
    let replybutton = new HTML('button', {
        title: "Reply to this email",
        onclick: `compose_email('${json.mid}');`,
        class: 'btn toolbar_btn toolbar_button_reply'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-pencil'
    }, ' '));
    toolbar.inject(replybutton);

    // permalink button
    let linkbutton = new HTML('a', {
        href: 'thread/%s'.format(json.mid),
        target: '_self',
        title: "Permanent link to this email",
        class: 'btn toolbar_btn toolbar_button_link'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-link'
    }, ' '));
    toolbar.inject(linkbutton);

    // Source-view button
    let sourcebutton = new HTML('a', {
        href: '%sapi/source.lua?id=%s'.format(apiURL, json.mid),
        target: '_self',
        title: "View raw source",
        class: 'btn toolbar_btn toolbar_button_source'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-file'
    }, ' '));
    toolbar.inject(sourcebutton);

    // Admin button?
    if (ponymail_preferences.login && ponymail_preferences.login.credentials && ponymail_preferences.login.credentials.admin) {
        let adminbutton = new HTML('a', {
            href: 'admin/%s'.format(json.mid),
            target: '_self',
            title: "Modify email",
            class: 'btn toolbar_btn toolbar_button_admin'
        }, new HTML('span', {
            class: 'glyphicon glyphicon-cog'
        }, ' '));
        toolbar.inject(adminbutton);
    }

    text.inject(toolbar);
}



async function render_email_chatty(state, json) {
    let div = state.div;
    div.parentNode.style.border = 'none';

    // Author
    let when = new Date(json.epoch * 1000.0);
    let ldate = when.toISOString();
    try {
        ldate = "%s %s".format(when.toLocaleDateString('en-US', ponymail_date_format), when.toLocaleTimeString());
    } catch (e) {

    }

    let author_field = new HTML('div', {
        class: 'chatty_author'
    });
    let gravatar = new HTML('img', {
        class: "chatty_gravatar",
        src: "https://secure.gravatar.com/avatar/%s.png?s=96&r=g&d=mm".format(json.gravatar)
    });
    let author_name = json.from.replace(/\s*<.+>/, "").replace(/"/g, '');
    let author_email = json.from.match(/\s*<(.+@.+)>\s*/);
    if (author_name.length == 0) author_name = author_email ? author_email[1] : "(No author?)";
    let author_nametag = new HTML('div', {
        class: 'chatty_author_name'
    }, [
        new HTML('b', {}, author_name),
        " - %s".format(ldate)
    ]);
    author_field.inject([gravatar, author_nametag]);
    div.inject(author_field);
    let chatty_body = fixup_quotes(json.body);
    if (json.mid == current_open_email) {
        let header = new HTML('h4', {
            class: 'chatty_title_inline'
        }, json.subject);
        chatty_body.unshift(header);
    }
    let text = new HTML('pre', {
        class: 'chatty_body'
    }, chatty_body);
    div.inject(text);

    // Private text?
    if (json.private === true) {
        text.style.backgroundImage = "url(images/private.png)";
    }

    // Attachments?
    if (json.attachments && json.attachments.length > 0) {
        let attach_field = new HTML('div', {
            class: 'email_kv'
        });
        let attach_key = new HTML('div', {
            class: 'email_key'
        }, "Attachment(s):");
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
        text.inject(attach_field);
    }

    let toolbar = new HTML('div', {
        class: 'toolbar_chatty'
    });

    // reply to email button
    let replybutton = new HTML('button', {
        title: "Reply to this email",
        onclick: `compose_email('${json.mid}');`,
        class: 'btn toolbar_btn toolbar_button_reply'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-pencil'
    }, ' '));
    toolbar.inject(replybutton);

    // permalink button
    let linkbutton = new HTML('a', {
        href: 'thread/%s'.format(json.mid),
        title: "Permanent link to this email",
        target: '_self',
        class: 'btn toolbar_btn toolbar_button_link'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-link'
    }, ' '));
    toolbar.inject(linkbutton);

    // Source-view button
    let sourcebutton = new HTML('a', {
        href: '%sapi/source.lua?id=%s'.format(apiURL, json.mid),
        target: '_self',
        title: "View raw source",
        class: 'btn toolbar_btn toolbar_button_source'
    }, new HTML('span', {
        class: 'glyphicon glyphicon-file'
    }, ' '));
    toolbar.inject(sourcebutton);

    // Admin button?
    if (ponymail_preferences.login && ponymail_preferences.login.credentials && ponymail_preferences.login.credentials.admin) {
        let adminbutton = new HTML('a', {
            href: 'admin/%s'.format(json.mid),
            target: '_self',
            title: "Modify email",
            class: 'btn toolbar_btn toolbar_button_admin'
        }, new HTML('span', {
            class: 'glyphicon glyphicon-cog'
        }, ' '));
        toolbar.inject(adminbutton);
    }

    text.inject(toolbar);
}
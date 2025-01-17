/*
 Licensed to the Apache Software Foundation (ASF) under one or more
 contributor license agreements.  See the NOTICE file distributed with
 this work for additional information regarding copyright ownership.
 The ASF licenses this file to You under the Apache License, Version 2.0
 (the "License"); you may not use this file except in compliance with
 the License.  You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
let current_open_email = null;

function expand_email_threaded(idx, flat) {
    let placeholder = document.getElementById('email_%u'.format(idx));
    if (placeholder) {
        // Check if email is already visible - if so, hide it!
        if (placeholder.style.display == 'block') {
            console.log("Collapsing thread at index %u".format(idx));
            placeholder.style.display = 'none';
            current_email_idx = undefined;
            return false;
        }
        current_email_idx = idx;
        console.log("Expanding thread at index %u".format(idx));
        placeholder.style.display = 'block';

        // Check if we've already filled out the structure here
        if (placeholder.getAttribute('data-filled') == 'yes') {
            console.log("Already constructed this thread, bailing!");
        } else {
            // Construct the base scaffolding for all emails
            let eml = flat ? current_json.emails[idx] : current_json.thread_struct[idx];
            if (eml) {
                current_open_email = eml.tid || eml.mid;
            }
            let thread = construct_thread(eml);
            placeholder.inject(thread);
            placeholder.setAttribute("data-filled", 'yes');
        }
    }
    return false;
}

function construct_thread(thread, cid, nestlevel, included) {
    // First call on a thread/email, this is indef.
    // Use this to plop a scroll call when loaded
    // to prevent weird cache-scrolling
    let doScroll = false;
    if (cid === undefined) {
        doScroll = true;
    }
    included = included || [];
    cid = (cid || 0) + 1;
    nestlevel = (nestlevel || 0) + 1;
    let mw = calc_email_width();
    let max_nesting = ponymail_max_nesting;
    if (mw < 700) {
        max_nesting = Math.floor(mw / 250);
    }
    cid %= 5;
    let color = ['286090', 'ccab0a', 'c04331', '169e4e', '6d4ca5'][cid];
    let email = undefined;
    if (nestlevel < max_nesting) {
        email = new HTML('div', {
            class: 'email_wrapper',
            id: 'email_%s'.format(thread.tid || thread.id)
        });
        if (chatty_layout) {
            email.style.border = "none !important";
        } else {
            email.style.borderLeft = '3px solid #%s'.format(color);
        }
    } else {
        email = new HTML('div', {
            class: 'email_wrapper_nonest',
            id: 'email_%s'.format(thread.tid || thread.id)
        });
    }
    let wrapper = new HTML('div', {
        class: 'email_inner_wrapper',
        id: 'email_contents_%s'.format(thread.tid || thread.id)
    });
    email.inject(wrapper);
    if (isArray(thread.children)) {
        thread.children.sort((a, b) => a.epoch - b.epoch);
        for (var i = 0; i < thread.children.length; i++) {
            let reply = construct_thread(thread.children[i], cid, nestlevel, included);
            cid++;
            if (reply) {
                email.inject(reply);
            }
        }
    }
    let tid = thread.tid || thread.id;
    if (!included.includes(tid)) {
        included.push(tid);
        console.log("Loading email %s".format(tid));
        GET("%sapi/email.lua?id=%s".format(apiURL, tid), render_email, {
            cached: true,
            scroll: doScroll,
            id: tid,
            div: wrapper
        });
    }
    return email;
}

// Singular thread construction via permalinks
function construct_single_thread(state, json) {
    current_json = json;
    if (json) {
        // Old schema has json.error filled on error, simplified schema has json.message filled and json.okay set to false
        let error_message = json.okay === false ? json.message : json.error;
        if (error_message) {
            modal("An error occured", "Sorry, we hit a snag while trying to load the email(s): \n\n%s".format(error_message), "error");
            return;
        }
    }
    let div = document.getElementById('emails');
    div.innerHTML = "";
    if (chatty_layout) {
        let listname = json.thread.list_raw.replace(/[<>]/g, '').replace('.', '@', 1);
        div.setAttribute("class", "email_placeholder_chatty");
        div.inject(new HTML('h4', {
            class: 'chatty_title'
        }, json.emails[0].subject));
        div.inject(new HTML('a', {
            href: 'list.html?%s'.format(listname),
            class: 'chatty_title'
        }, 'Posted to %s'.format(listname)));
    } else {
        div.setAttribute("class", "email_placeholder");
    }
    div.style.display = "block";
    let thread = json.thread;
    let email = construct_thread(thread);
    div.inject(email);
}
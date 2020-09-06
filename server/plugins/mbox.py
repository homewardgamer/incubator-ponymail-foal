#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
This is the mbox library for Pony Mail.
It handles fetching (the right) emails for
pages that need it.
"""


import base64
import binascii
import datetime
import email.utils
import hashlib
# Main imports
import re
import typing

from elasticsearch.helpers import async_scan

import plugins.aaa
import plugins.session

PYPONY_RE_PREFIX = re.compile(r"^([a-zA-Z]+:\s*)+")

mbox_cache_privacy = {}


def extract_name(addr):
    """ Extract name and email from from: header """
    m = re.match(r"^([^<]+)\s*<(.+)>$", addr)
    if m:
        return [m.group(1), m.group(2)]
    else:
        addr = addr.strip("<>")
        return [addr, addr]


def anonymize(doc):
    """ Anonymizes an email, hiding author email addresses."""
    # ES direct hit?
    ptr: typing.Dict[str, str] = doc
    if "_source" in doc:
        ptr = doc["_source"]

    if "from" in ptr:
        frname, fremail = extract_name(ptr["from"])
        ptr["md5"] = hashlib.md5(
            bytes(fremail.lower(), encoding="ascii", errors="replace")
        ).hexdigest()
        ptr["from"] = re.sub(
            r"<(\S{1,2})\S*@([-a-zA-Z0-9_.]+)>", "<\\1..@\\2>", ptr["from"]
        )
        if ptr["body"]:
            ptr["body"] = re.sub(
                r"<(\S{1,2})\S*@([-a-zA-Z0-9_.]+)>", "<\\1..@\\2>", ptr["body"]
            )
    return doc


async def find_parent(session, doc: typing.Dict[str, str]):
    """
    Locates the first email in a thread by going back through all the
    in-reply-to headers and finding their source.
    """
    step = 0
    # max 50 steps up in the hierarchy
    while step < 50:
        step = step + 1
        irt: str = doc["in-reply-to"] if "in-reply-to" in doc else None
        if not irt:
            break  # Shouldn't happen because irt is always present currently
        # Extract the reference, if any
        m = re.search(r"(<[^>]+>)", irt)
        if not m:
            break
        ref = m.group(1)
        newdoc = await get_email(session, messageid=ref)
        # Did we find something, and can the user access it?
        if not newdoc or not plugins.aaa.can_access_email(session, newdoc):
            break
        else:
            doc = newdoc
    return doc


async def fetch_children(session, pdoc, counter=0, pdocs=None, short=False):
    """
    Fetches all child messages of a parent email
    """
    if pdocs is None:
        pdocs = {}
    counter = counter + 1
    if counter > 250:
        return []
    docs = await get_email(session, irt=pdoc["message-id"])

    thread = []
    emails = []
    for doc in docs:
        # Make sure email is accessible
        if plugins.aaa.can_access_email(session, doc):
            if doc["mid"] not in pdocs:
                mykids, myemails, pdocs = await fetch_children(
                    session, doc, counter, pdocs, short=short
                )
                if short:
                    xdoc = {
                        "tid": doc["mid"],
                        "mid": doc["mid"],
                        "message-id": doc["message-id"],
                        "subject": doc["subject"],
                        "from": doc["from"],
                        "id": doc["mid"],
                        "epoch": doc["epoch"],
                        "children": mykids,
                        "irt": doc["in-reply-to"],
                        "list_raw": doc["list_raw"],
                    }
                    thread.append(xdoc)
                    pdocs[doc["mid"]] = xdoc
                else:
                    thread.append(doc)
                    pdocs[doc["mid"]] = doc
                for kid in mykids:
                    if kid["mid"] not in pdocs:
                        pdocs[kid["mid"]] = kid
                        emails.append(kid)
    return thread, emails, pdocs


async def get_email(
    session: plugins.session.SessionObject,
    permalink: str = None,
    messageid=None,
    irt=None,
    source=False,
):
    doctype = session.database.dbs.mbox
    if source:
        doctype = session.database.dbs.source
    # Older indexes may need a match instead of a strict terms agg in order to find
    # emails in DBs that may have been incorrectly analyzed.
    aggtype = "match"
    if permalink:
        try:
            doc = await session.database.get(index=doctype, id=permalink)
            if doc and plugins.aaa.can_access_email(session, doc):
                if not session.credentials:
                    doc = anonymize(doc)
                doc["_source"]["id"] = doc["_source"]["mid"]
                return doc["_source"]
        except session.database.DBError:
            pass
    elif messageid:
        res = await session.database.search(
            index=doctype,
            size=1,
            body={"query": {"bool": {"must": [{aggtype: {"message-id": messageid}}]}}},
        )
        if len(res["hits"]["hits"]) == 1:
            doc = res["hits"]["hits"][0]["_source"]
            doc["id"] = doc["mid"]
            if plugins.aaa.can_access_email(session, doc):
                if not session.credentials:
                    doc = anonymize(doc)
                return doc
    elif irt:
        res = await session.database.search(
            index=doctype,
            size=250,
            body={"query": {"bool": {"must": [{aggtype: {"in-reply-to": irt}}]}}},
        )
        docs = []
        for doc in res["hits"]["hits"]:
            if plugins.aaa.can_access_email(session, doc):
                if not session.credentials:
                    doc = anonymize(doc)
                doc["_source"]["id"] = doc["_source"]["mid"]
                docs.append(doc["_source"])
        return docs
    return None


async def get_source(session: plugins.session.SessionObject, permalink: str = None):
    doctype = session.database.dbs.source
    try:
        doc = await session.database.get(index=doctype, id=permalink)
        return doc
    except session.database.DBError:
        pass
    res = await session.database.search(
        index=doctype,
        size=1,
        body={"query": {"bool": {"must": [{"match": {"permalink": permalink}}]}}},
    )
    if len(res["hits"]["hits"]) == 1:
        doc = res["hits"]["hits"][0]
        doc["id"] = doc["_id"]
        # Check for base64-encoded source
        if ':' not in doc['_source']['source']:
            try:
                doc['_source']['source'] = base64.standard_b64decode(doc['_source']['source'])\
                    .decode('utf-8', 'replace')
            except binascii.Error:
                pass  # If it wasn't base64 after all, just return as is
        return doc
    return None


def get_list(session, listid, fr=None, to=None, limit=10000):
    """
    Loads emails from a specified list.
    If fr and to are not specified, loads the last 30 days.
    """
    res = session.DB.ES.search(
        index=session.DB.dbs.mbox,
        size=limit,
        body={
            "query": {"bool": {"must": [{"term": {"list_raw": listid}}]}},
            "sort": [{"epoch": {"order": "asc"}}],
        },
    )
    docs = []
    for hit in res["hits"]["hits"]:
        doc = hit["_source"]
        if plugins.aaa.can_access_email(session, doc):
            if not session.user:
                doc = anonymize(doc)
            docs.append(doc)
    return docs


async def query(
    session: plugins.session.SessionObject,
    query_defuzzed,
    query_limit=10000,
    shorten=False,
):
    """
    Advanced query and grab for stats.py
    """
    docs = []
    hits = 0
    async for hit in async_scan(
        client=session.database.client,
        query={
            "query": {"bool": query_defuzzed},
            "sort": [{"epoch": {"order": "asc"}}],
        },
    ):
        doc = hit["_source"]
        doc["id"] = doc["mid"]
        if plugins.aaa.can_access_email(session, doc):
            if not session.credentials:
                doc = anonymize(doc)
            if shorten:
                doc["body"] = (doc["body"] or "")[:200]
            docs.append(doc)
            hits += 1
            if hits > query_limit:
                break
    return docs


async def wordcloud(session, query_defuzzed):
    """
    Wordclouds via significant terms query in ES
    """
    wc = {}
    res = await session.database.search(
        body={
            "size": 0,
            "query": {"bool": query_defuzzed},
            "aggregations": {
                "cloud": {"significant_terms": {"field": "subject", "size": 10}}
            },
        }
    )

    for hit in res["aggregations"]["cloud"]["buckets"]:
        wc[hit["key"]] = hit["doc_count"]

    return wc


def is_public(session: plugins.session.SessionObject, listname):
    """ Quickly determine if a list if fully public, private or mixed """
    if "@" not in listname:
        lname, ldomain = listname.strip("<>").split(".", 1)
        listname = f"{lname}@{ldomain}"
    if listname in session.server.data.lists:
        return not session.server.data.lists[listname]["private"]
    else:
        return False  # Default to not public


async def get_list_stats(session, maxage="90d", admin=False):
    """
    Fetches a list of all mailing lists available (and visible).
    Use the admin flag to override AAA and see everything
    """
    daterange = {"gt": "now-%s" % maxage, "lt": "now+1d"}
    res = session.database.search(
        index=session.DB.dbs.mbox,
        size=0,
        body={
            "query": {"bool": {"must": [{"range": {"date": daterange}}]}},
            "aggs": {"listnames": {"terms": {"field": "list_raw", "size": 10000}}},
        },
    )
    lists = {}
    for entry in res["aggregations"]["listnames"]["buckets"]:

        # Normalize list name
        listname = entry["key"].lower().strip("<>")

        # Check access
        if (
            is_public(session, listname)
            or admin
            or plugins.aaa.canViewList(session, listname)
        ):
            # Change foo.bar.baz to foo@bar.baz
            listname = listname.replace(".", "@", 1)
            lists[listname] = entry["doc_count"]
    return lists


async def get_years(session, query_defuzzed):
    """ Fetches the oldest and youngest email, returns the years between them """

    # Get oldest doc
    res = await session.database.search(
        index=session.database.dbs.mbox,
        size=1,
        body={"query": {"bool": query_defuzzed}, "sort": {"epoch": "asc"}},
    )
    oldest = 1970
    if res["hits"]["hits"]:
        doc = res["hits"]["hits"][0]
        oldest = datetime.datetime.fromtimestamp(doc["_source"]["epoch"]).year

    # Get youngest doc
    res = await session.database.search(
        size=1, body={"query": {"bool": query_defuzzed}, "sort": {"epoch": "desc"}}
    )
    youngest = 1970
    if res["hits"]["hits"]:
        doc = res["hits"]["hits"][0]
        youngest = datetime.datetime.fromtimestamp(doc["_source"]["epoch"]).year

    return oldest, youngest


def find_root_subject(threads, hashdict, root_email, osubject=None):
    """Finds the discussion origin of an email, if present"""
    irt = root_email.get("in-reply-to")
    subject = root_email.get("subject")
    subject = subject.replace("\n", "")  # Crop multi-line subjects

    # First, the obvious - look for an in-reply-to in our existing dict with a matching subject
    if irt and irt in hashdict:
        if hashdict[irt].get("subject") == subject:
            return hashdict[irt]

    # If that failed, we break apart our subject
    if osubject:
        rsubject = osubject
    else:
        rsubject = PYPONY_RE_PREFIX.sub("", subject) + "_" + root_email.get("list_raw")
    for thread in threads:
        if thread.get("tsubject") == rsubject:
            return thread

    return None


def construct_threads(emails: typing.List[typing.Dict]):
    """Turns a list of emails into a nested thread structure"""
    threads = []
    authors = {}
    hashdict = {}
    for cur_email in sorted(emails, key=lambda x: x["epoch"]):
        author = cur_email.get("from")
        if author not in authors:
            authors[author] = 0
        authors[author] += 1
        subject = cur_email.get("subject").replace("\n", "")  # Crop multi-line subjects
        tsubject = PYPONY_RE_PREFIX.sub("", subject) + "_" + cur_email.get("list_raw")
        parent = find_root_subject(threads, hashdict, cur_email, tsubject)
        xemail = {
            "children": [],
            "tid": cur_email.get("mid"),
            "subject": subject,
            "tsubject": tsubject,
            "epoch": cur_email.get("epoch"),
            "nest": 1,
        }
        if not parent:
            threads.append(xemail)
        else:
            xemail["nest"] = parent["nest"] + 1
            parent["children"].append(xemail)
        hashdict[cur_email.get("message-id", "??")] = xemail
    return threads, authors


def gravatar(eml):
    """Generates a gravatar hash from an email address"""
    if isinstance(eml, str):
        header_from = eml
    else:
        header_from = eml.get("from", "??")
    mailaddr = email.utils.parseaddr(header_from)[1]
    ghash = hashlib.md5(mailaddr.encode("utf-8")).hexdigest()
    return ghash
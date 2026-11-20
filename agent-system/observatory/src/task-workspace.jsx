import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, ChevronRight, Filter, GitBranch, Plus, Search } from 'lucide-react';
import { dependencyGraph, organizeTasks, taskHref } from './task-workspace.mjs';

const defaultFilters = { query: '', source: 'all', state: 'all', sort: 'newest', group: 'none' };
const labels = value => value.replaceAll('_', ' ');
const date = value => value ? new Date(value).toLocaleDateString() : 'Unavailable';

export function TaskRows({ tasks, controls, related, activityFor, Status }) {
  const reduce = useReducedMotion();
  return <ul className="task-rows">
    <AnimatePresence initial={false}>
      {tasks.map(task => {
        const control = Object.hasOwn(controls, task.id) ? controls[task.id] : null;
        return <motion.li key={task.id} layout={reduce ? false : 'position'}
          initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: reduce ? 0 : .18 }}>
          <a className="task-row" href={taskHref(task.id)}>
            <span className="task-row-title">
              <strong>{task.title}</strong>
              <small>{task.classification?.primary ?? 'Class unavailable'} · {date(task.created_at)}</small>
            </span>
            <span className="task-row-state"><small>Task state</small><Status value={task.state}/></span>
            <span className="task-priority">{control ? control.priority + ' priority' : 'Priority unavailable'}</span>
            <span className="task-counts"><TaskActivityLabel activity={activityFor(task)}/><small>{related(task.id, 'attempt').length} attempts · {related(task.id, 'evidence').length} evidence</small></span>
            <span className="task-row-action">{control ? 'Manage' : 'Inspect'}<ChevronRight size={15} aria-hidden="true"/></span>
          </a>
        </motion.li>;
      })}
    </AnimatePresence>
  </ul>;
}

export function TaskExplorer({ tasks, controls, related, activityFor, Status, Panel, onCreate, loading, filters, setFilters }) {
  const groups = useMemo(() => organizeTasks(tasks, filters, controls), [tasks, filters, controls]);
  const states = [...new Set(tasks.map(task => task.state).filter(Boolean))].sort();
  const count = groups.reduce((sum, [, items]) => sum + items.length, 0);
  const field = event => {
    const { name, value } = event.currentTarget;
    setFilters(previous => ({ ...previous, [name]: value }));
  };
  return <Panel title="Task explorer" right={<button className="primary-button" type="button" onClick={onCreate}>
    <Plus size={16} aria-hidden="true"/> Create proposal
  </button>}>
    <div className="task-filters">
      <label>Search <span className="search"><Search size={16} aria-hidden="true"/>
        <input name="query" type="search" value={filters.query} onChange={field} placeholder="Title, objective, or ID"/>
      </span></label>
      <div className="task-filter"><label htmlFor="task-filter-source">Source</label><select id="task-filter-source" name="source" value={filters.source} onChange={field}>
        <option value="all">All Tasks</option><option value="private">Manageable private proposals</option>
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-state">State</label><select id="task-filter-state" name="state" value={filters.state} onChange={field}>
        <option value="all">All states</option>
        {[...new Set([...states, ...(filters.state === 'all' ? [] : [filters.state])])].map(state =>
          <option key={state} value={state}>{labels(state)}</option>)}
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-sort">Sort</label><select id="task-filter-sort" name="sort" value={filters.sort} onChange={field}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        <option value="priority">Highest priority</option><option value="title">Title</option>
      </select></div>
      <div className="task-filter"><label htmlFor="task-filter-group">Group</label><select id="task-filter-group" name="group" value={filters.group} onChange={field}>
        <option value="none">None</option><option value="state">State</option><option value="category">Category</option>
      </select></div>
    </div>
    <div className="task-result-bar">
      <span role="status"><Filter size={14} aria-hidden="true"/> {count} of {tasks.length} Tasks</span>
      {filters !== defaultFilters && <button className="text-button" type="button" onClick={() => setFilters(defaultFilters)}>Reset filters</button>}
    </div>
    {!loading && !count && <p>{tasks.length ? 'No Tasks match these filters.' : 'No Tasks in the current feed.'}</p>}
    {groups.map(([label, items]) => <section key={label} className="task-group" aria-label={labels(label)}>
      {filters.group !== 'none' && <h3>{labels(label)} <span>{items.length}</span></h3>}
      <TaskRows tasks={items} controls={controls} related={related} activityFor={activityFor} Status={Status}/>
    </section>)}
  </Panel>;
}

export function useTaskFilters() {
  return useState(defaultFilters);
}

export function TaskDependencies({ task, tasks, Status }) {
  const graph = dependencyGraph(task, tasks);
  const renderNodes = (nodes, empty, showStatus) => nodes.length ? <ul className="dependency-nodes">
    {nodes.map(node => <li key={node.id}>
      {node.task ? <a href={taskHref(node.id)}>{node.task.title}</a> : <span className="mono">{node.id}</span>}
      <Status value={showStatus ? node.status : node.task?.state}/>
    </li>)}
  </ul> : <p className="low">{empty}</p>;
  return <>
    <div className="dependency-graph">
      <div><h3>Prerequisite Tasks</h3>{renderNodes(graph.upstream, 'None declared', true)}</div>
      <ArrowDown className="dependency-arrow" size={19} aria-hidden="true"/>
      <div className="dependency-focus"><GitBranch size={16} aria-hidden="true"/><strong>{task.title}</strong></div>
      <ArrowDown className="dependency-arrow" size={19} aria-hidden="true"/>
      <div><h3>Dependent Tasks</h3>{renderNodes(graph.downstream, 'None in the current feed', false)}</div>
    </div>
    <h3 className="subheading">Required capabilities</h3>
    {task.prerequisites?.capabilities?.length ? <ul className="dependency-nodes">
      {task.prerequisites.capabilities.map((capability, index) => <li key={index}><span>{capability}</span><Status value="unverified"/></li>)}
    </ul> : <p className="low">None declared</p>}
  </>;
}

export function TaskCapabilitySummary({ manageable }) {
  return <div className="task-capabilities">
    <h3>Execution controls</h3>
    <p>{manageable ? 'Proposal state and editing are available below.' : 'This source publishes Task records for inspection.'}</p>
    <dl>
      <div><dt>Schedule and dispatch</dt><dd>Unavailable from this Task source</dd></div>
      <div><dt>Pause, resume, stop and retry</dt><dd>Unavailable from this Task source</dd></div>
    </dl>
    <a className="text-button" href="#tasks">Browse Tasks <ArrowRight size={14} aria-hidden="true"/></a>
  </div>;
}

export function TaskActivityLabel({ activity }) {
  return <span className="task-activity-label"><strong>{activity.label}</strong>{activity.at&&<time dateTime={activity.at}>{new Date(activity.at).toLocaleString()}</time>}</span>;
}

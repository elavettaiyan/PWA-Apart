# Generic Approval Module

## Overview

The Approval Module is a centralized and reusable framework that can be integrated with any feature across the application. It enables configurable approval workflows while maintaining a consistent user experience, audit trail, and notification mechanism.

The framework is designed to support current and future approval scenarios without requiring module-specific implementations.

---

# Objectives

* Provide a reusable approval workflow engine.
* Support approval-based business processes across the application.
* Deliver approval requests through push notifications and in-app notifications.
* Maintain complete approval history and audit trail.
* Apply changes only after approval.
* Allow communities to decide which actions require approval.

---

# Approval Configuration

Approval workflows will be configuration-driven.

For each supported business action, administrators can configure:

### Configuration Options

* Approval Required (Enabled / Disabled)
* Approver Role(s)

If approval is disabled, the action is processed immediately.

If approval is enabled, an approval request is generated and routed to the configured approvers.

---

# Approver Roles

One or more approver roles can be configured for a business action.

Examples:

* Owner
* Admin
* Secretary
* President
* Association Member

Multiple roles can be assigned to the same approval policy.

---

# Approval Modes

## Any One Can Approve

The request is approved as soon as any one eligible approver approves it.

Example:

Approvers:

* Association Member
* Admin

If either approver approves, the request is completed.

---

## All Must Approve (Future Enhancement)

All configured approvers must approve before the request is completed.

---

## Minimum Approval Count (Future Enhancement)

A configurable number of approvals will be required.

Example:

Approvers:

* Secretary
* President
* Treasurer

Minimum Required:

* 2

---

# Notification Support

## Push Notifications

Approvers receive real-time push notifications whenever a request requires their attention.

Examples:

* Tenant registration awaiting approval.
* Tenant profile change awaiting approval.

---

## In-App Notifications

Approval requests will be available under:

Community → Approvals

Unread requests will be highlighted using badge counts.

---

# Community Integration

A new Approvals section will be available within the Community module.

### Community

* Announcements
* Discussions
* Polls
* Approvals

The Approvals section will display:

* Pending Requests
* Approved Requests
* Rejected Requests

---

# Approval Workflow

## Request Creation

When a configured action requires approval:

1. User performs the action.
2. Approval request is created.
3. Request is saved with Pending status.
4. Push notification is sent.
5. Request appears in Community → Approvals.

---

## Approval

When approved:

1. Request status changes to Approved.
2. Target entity is updated.
3. Business process continues.
4. Audit entry is created.

---

## Rejection

When rejected:

1. Request status changes to Rejected.
2. Pending changes are discarded.
3. Existing data remains unchanged.
4. Audit entry is created.

---

# Approval Status

Supported statuses:

* Pending
* Approved
* Rejected
* Cancelled
* Expired (Future Enhancement)

---

# Audit Trail

All approval activities will be tracked.

### Audit Information

* Requested By
* Requested Date
* Approved By
* Approved Date
* Rejected By
* Rejected Date
* Comments

This ensures complete traceability.

---

# Use Case 1: Tenant Registration

## Business Scenario

An Owner wants to register a Tenant for a Flat.

## Approval Flow

Requested By:

* Owner

Approvers:

* Association Members

Approval Required:

* Configurable

## Process

1. Owner creates Tenant registration.
2. Approval request is generated.
3. Association Members receive notification.
4. Request appears in Community → Approvals.
5. Association Member reviews the request.
6. Request is approved or rejected.

## Result

### Approved

* Tenant becomes active.
* Tenant is mapped to the Flat.
* Registration process is completed.

### Rejected

* Tenant remains unregistered.
* No mapping is created.

---

# Use Case 2: Tenant Profile Changes

## Business Scenario

A Tenant updates profile information.

Examples:

* Mobile Number
* Vehicle Information

## Approval Flow

Requested By:

* Tenant

Approver:

* Owner

Approval Required:

* Configurable

## Process

1. Tenant updates profile information.
2. Approval request is generated.
3. Owner receives notification.
4. Request appears in Community → Approvals.
5. Owner reviews proposed changes.
6. Request is approved or rejected.

## Result

### Approved

* Updated information is applied.
* Profile reflects new values.

### Rejected

* Existing profile information remains unchanged.

---

# Technical Design

## Approval Policy

Stores approval configuration.

Fields:

* Module
* Action
* Approval Required
* Approver Roles
* Is Active

---

## Approval Request

Stores approval transactions.

Fields:

* Request Id
* Module
* Action
* Entity Id
* Requested By
* Status
* Current Data
* Proposed Data
* Requested On

---

## Approval Decision

Stores approver actions.

Fields:

* Request Id
* Approver Role
* Approver User
* Status
* Comments
* Action Date

---

# Future Use Cases

The same framework can later support:

* Flat Ownership Transfer
* Resident Deletion
* Parking Allocation
* Visitor Access Approval
* Community Configuration Changes
* Asset Purchase Approval
* Expense Approval
* Vendor Approval

No additional approval engine development will be required for these scenarios.

---

# Benefits

* Single reusable approval framework.
* Consistent user experience.
* Push notification and in-app approval support.
* Complete audit trail.
* Configuration-driven workflow management.
* Scalable for future community processes.
* Reduced development effort for future approval-based features.
